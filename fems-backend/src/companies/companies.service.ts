import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  AuditSeverity,
  CompanyStatus,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { GisService } from '../gis/gis.service';
import { GisFeatureType } from '@prisma/client';
import { canReadAll, companyScope } from '../common/utils/access-scope.util';
import { resolveOrderBy } from '../common/dto/pagination.dto';
import { assertCoordinates } from '../common/utils/geo.util';
import type { AuthenticatedUser } from '../common/decorators';
import type {
  CompanyDocumentQueryDto,
  CompanyQueryDto,
  CreateCompanyDocumentDto,
  CreateCompanyDto,
  SuspendCompanyDto,
  UpdateCompanyDto,
  VerifyCompanyDto,
  VerifyDocumentDto,
} from './dto/company.dto';

const SORTABLE = ['createdAt', 'name', 'status', 'region', 'verifiedAt'] as const;

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly gis: GisService,
  ) {}

  /** Company representatives may only read and update their own company. */
  private assertCompanyAccess(user: AuthenticatedUser, companyId: string): void {
    if (canReadAll(user, 'companies')) return;
    if (user.companyId !== companyId) {
      throw new ForbiddenException({
        code: 'COMPANY_SCOPE_FORBIDDEN',
        message: 'You can only access your own company record.',
      });
    }
  }

  async list(user: AuthenticatedUser, query: CompanyQueryDto) {
    const scope = companyScope(user, 'companies');
    const where: Prisma.CompanyWhereInput = {
      deletedAt: null,
      status: query.status,
      type: query.type,
      region: query.region,
      // `companyScope` returns the caller's `companyId`, which is a column on most
      // models but not on `Company` itself — there the row *is* the company, so the
      // scope becomes a primary-key filter.
      ...(scope.companyId ? { id: scope.companyId } : {}),
      OR: query.search
        ? [
            { name: { contains: query.search } },
            { registrationNumber: { contains: query.search } },
            { city: { contains: query.search } },
          ]
        : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        include: {
          _count: { select: { permits: true, activities: true, members: true, documents: true } },
          verifiedBy: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: resolveOrderBy(query.sortBy, query.sortOrder, [...SORTABLE], 'createdAt'),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.company.count({ where }),
    ]);

    return { items, total };
  }

  async findOne(user: AuthenticatedUser, id: string) {
    this.assertCompanyAccess(user, id);
    const company = await this.prisma.company.findFirst({
      where: { id, deletedAt: null },
      include: {
        documents: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
        },
        members: {
          where: { deletedAt: null },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            jobTitle: true,
            status: true,
            userRoles: { select: { role: { select: { name: true, label: true } } } },
          },
        },
        verifiedBy: { select: { id: true, firstName: true, lastName: true } },
        _count: {
          select: {
            permits: true,
            activities: true,
            payments: true,
            inspections: true,
            violations: true,
            equipment: true,
          },
        },
      },
    });
    if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND', message: 'Company not found.' });

    const permitsByStatus = await this.prisma.exploitationPermit.groupBy({
      by: ['status'],
      where: { companyId: id, deletedAt: null },
      _count: { _all: true },
    });

    return {
      ...company,
      members: company.members.map((member) => ({
        ...member,
        roles: member.userRoles.map((userRole) => userRole.role),
        userRoles: undefined,
      })),
      permitSummary: permitsByStatus.map((row) => ({ status: row.status, count: row._count._all })),
    };
  }

  async create(user: AuthenticatedUser, dto: CreateCompanyDto) {
    const existing = await this.prisma.company.findFirst({
      where: {
        OR: [{ name: dto.name }, { registrationNumber: dto.registrationNumber }],
        deletedAt: null,
      },
    });
    if (existing) {
      throw new ConflictException({
        code: 'COMPANY_ALREADY_EXISTS',
        message: `A company with this ${existing.name === dto.name ? 'name' : 'registration number'} already exists.`,
      });
    }

    const company = await this.prisma.company.create({
      data: {
        name: dto.name.trim(),
        registrationNumber: dto.registrationNumber.trim(),
        taxNumber: dto.taxNumber,
        type: dto.type,
        status: CompanyStatus.PENDING,
        email: dto.email.toLowerCase(),
        phone: dto.phone,
        alternatePhone: dto.alternatePhone,
        addressLine: dto.addressLine,
        city: dto.city,
        region: dto.region,
        country: dto.country ?? 'Cameroun',
        website: dto.website,
        latitude: dto.latitude ?? null,
        longitude: dto.longitude ?? null,
        employeeCount: dto.employeeCount,
        description: dto.description,
        ownerId: user.id,
      },
    });

    if (dto.latitude !== undefined && dto.longitude !== undefined) {
      assertCoordinates(dto.latitude, dto.longitude, 'company location');
      await this.gis.recordFeature({
        featureType: GisFeatureType.COMPANY_SITE,
        entityId: company.id,
        label: company.name,
        latitude: dto.latitude,
        longitude: dto.longitude,
        recordedById: user.id,
        source: 'SYSTEM_RECORDED',
      });
    }

    await this.audit.record({
      action: AuditAction.CREATE,
      entityType: 'Company',
      entityId: company.id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Registered company ${company.name}`,
      after: { name: company.name, registrationNumber: company.registrationNumber },
    });

    return company;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateCompanyDto) {
    this.assertCompanyAccess(user, id);
    const before = await this.prisma.company.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND', message: 'Company not found.' });

    const updated = await this.prisma.company.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        registrationNumber: dto.registrationNumber?.trim(),
        taxNumber: dto.taxNumber,
        type: dto.type,
        email: dto.email?.toLowerCase(),
        phone: dto.phone,
        alternatePhone: dto.alternatePhone,
        addressLine: dto.addressLine,
        city: dto.city,
        region: dto.region,
        country: dto.country,
        website: dto.website,
        latitude: dto.latitude,
        longitude: dto.longitude,
        employeeCount: dto.employeeCount,
        description: dto.description,
        // Editing a verified profile sends it back for review.
        status:
          before.status === CompanyStatus.VERIFIED &&
          (dto.registrationNumber !== undefined || dto.name !== undefined)
            ? CompanyStatus.PENDING
            : undefined,
      },
    });

    if (dto.latitude !== undefined && dto.longitude !== undefined) {
      assertCoordinates(dto.latitude, dto.longitude, 'company location');
      await this.gis.recordFeature({
        featureType: GisFeatureType.COMPANY_SITE,
        entityId: id,
        label: updated.name,
        latitude: dto.latitude,
        longitude: dto.longitude,
        recordedById: user.id,
      });
    }

    await this.audit.record({
      action: AuditAction.UPDATE,
      entityType: 'Company',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Updated company ${before.name}`,
      before: { name: before.name, status: before.status },
      after: { name: updated.name, status: updated.status },
    });

    return updated;
  }

  /** Regulatory verification decision — never automatic, always attributed. */
  async verify(user: AuthenticatedUser, id: string, dto: VerifyCompanyDto) {
    const company = await this.prisma.company.findFirst({ where: { id, deletedAt: null } });
    if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND', message: 'Company not found.' });
    if (company.status === CompanyStatus.SUSPENDED) {
      throw new BadRequestException({
        code: 'COMPANY_SUSPENDED',
        message: 'A suspended company must be restored before it can be verified.',
      });
    }

    const approved = dto.approved ?? true;
    if (approved && company.status === CompanyStatus.VERIFIED) {
      throw new BadRequestException({
        code: 'COMPANY_ALREADY_VERIFIED',
        message: `${company.name} is already verified.`,
      });
    }
    if (!approved && company.status === CompanyStatus.REJECTED) {
      throw new BadRequestException({
        code: 'COMPANY_ALREADY_REJECTED',
        message: `${company.name} was already rejected. Request new documents before reconsidering the file.`,
      });
    }
    if (!approved && !dto.rejectionReason) {
      throw new BadRequestException({
        code: 'REJECTION_REASON_REQUIRED',
        message: 'A rejection reason is required.',
      });
    }

    const verifiedCount = await this.prisma.companyDocument.count({
      where: { companyId: id, isVerified: true, deletedAt: null },
    });
    if (approved && verifiedCount === 0) {
      throw new BadRequestException({
        code: 'NO_VERIFIED_DOCUMENTS',
        message:
          'At least one verified company document (registration certificate or tax clearance) is required before approval.',
      });
    }

    const updated = await this.prisma.company.update({
      where: { id },
      data: {
        status: approved ? CompanyStatus.VERIFIED : CompanyStatus.REJECTED,
        verifiedAt: approved ? new Date() : null,
        verifiedById: user.id,
        rejectionReason: approved ? null : dto.rejectionReason,
      },
    });

    const members = await this.prisma.user.findMany({
      where: { companyId: id, deletedAt: null },
      select: { id: true },
    });
    await this.notifications.notify({
      userIds: members.map((member) => member.id),
      type: NotificationType.COMPANY_VERIFIED,
      severity: approved ? AuditSeverity.INFO : AuditSeverity.WARNING,
      title: approved ? 'Company verified' : 'Company verification rejected',
      message: approved
        ? `${company.name} is now a verified FEMS company. You can apply for exploitation permits.`
        : `${company.name} verification was rejected: ${dto.rejectionReason}`,
      entityType: 'Company',
      entityId: id,
      actionUrl: `/companies/${id}`,
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      severity: AuditSeverity.WARNING,
      entityType: 'Company',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: approved
        ? `Verified company ${company.name} (${verifiedCount} document(s) verified)`
        : `Rejected company ${company.name}: ${dto.rejectionReason}`,
      before: { status: company.status },
      after: { status: updated.status },
    });

    return updated;
  }

  async updateStatus(user: AuthenticatedUser, id: string, dto: SuspendCompanyDto) {
    const company = await this.prisma.company.findFirst({ where: { id, deletedAt: null } });
    if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND', message: 'Company not found.' });
    const status = dto.status ?? CompanyStatus.SUSPENDED;

    const updated = await this.prisma.company.update({
      where: { id },
      data: { status, rejectionReason: status === CompanyStatus.REJECTED ? dto.reason : company.rejectionReason },
    });

    const members = await this.prisma.user.findMany({
      where: { companyId: id, deletedAt: null },
      select: { id: true },
    });
    await this.notifications.notify({
      userIds: members.map((member) => member.id),
      type: NotificationType.SYSTEM_ANNOUNCEMENT,
      severity: AuditSeverity.CRITICAL,
      title: `Company status changed to ${status}`,
      message: `${company.name}: ${dto.reason}`,
      entityType: 'Company',
      entityId: id,
    });

    await this.audit.record({
      action: AuditAction.ACCOUNT_STATUS_CHANGE,
      severity: AuditSeverity.CRITICAL,
      entityType: 'Company',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Company ${company.name} status ${company.status} → ${status}: ${dto.reason}`,
      before: { status: company.status },
      after: { status, reason: dto.reason },
    });

    return updated;
  }

  // ------------------------------------------------------------- documents

  async listDocuments(user: AuthenticatedUser, companyId: string, query: CompanyDocumentQueryDto) {
    this.assertCompanyAccess(user, companyId);
    const where: Prisma.CompanyDocumentWhereInput = {
      companyId,
      deletedAt: null,
      type: query.type,
      isVerified: query.isVerified === undefined ? undefined : query.isVerified === 'true',
    };
    const [items, total] = await Promise.all([
      this.prisma.companyDocument.findMany({
        where,
        include: {
          uploadedBy: { select: { id: true, firstName: true, lastName: true } },
          verifiedBy: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.companyDocument.count({ where }),
    ]);
    return { items, total };
  }

  async addDocument(user: AuthenticatedUser, companyId: string, dto: CreateCompanyDocumentDto) {
    this.assertCompanyAccess(user, companyId);
    const company = await this.prisma.company.findFirst({ where: { id: companyId, deletedAt: null } });
    if (!company) throw new NotFoundException({ code: 'COMPANY_NOT_FOUND', message: 'Company not found.' });

    const document = await this.prisma.companyDocument.create({
      data: {
        companyId,
        type: dto.type,
        title: dto.title,
        fileKey: dto.fileKey,
        fileUrl: dto.fileUrl ?? `/api/v1/files/download?key=${encodeURIComponent(dto.fileKey)}`,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        checksum: dto.checksum,
        notes: dto.notes,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        uploadedById: user.id,
      },
    });

    await this.audit.record({
      action: AuditAction.FILE_UPLOAD,
      entityType: 'CompanyDocument',
      entityId: document.id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Uploaded ${dto.type} for ${company.name}`,
      after: { type: dto.type, title: dto.title, fileKey: dto.fileKey },
    });

    return document;
  }

  async verifyDocument(user: AuthenticatedUser, companyId: string, documentId: string, dto: VerifyDocumentDto) {
    const document = await this.prisma.companyDocument.findFirst({
      where: { id: documentId, companyId, deletedAt: null },
      include: { company: { select: { id: true, name: true } } },
    });
    if (!document) {
      throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Document not found for this company.' });
    }

    const updated = await this.prisma.companyDocument.update({
      where: { id: documentId },
      data: {
        isVerified: dto.isVerified,
        verifiedAt: dto.isVerified ? new Date() : null,
        verifiedById: user.id,
        notes: dto.notes ?? document.notes,
      },
    });

    await this.audit.record({
      action: AuditAction.UPDATE,
      severity: AuditSeverity.WARNING,
      entityType: 'CompanyDocument',
      entityId: documentId,
      actorId: user.id,
      actorEmail: user.email,
      description: `${dto.isVerified ? 'Verified' : 'Un-verified'} ${document.type} of ${document.company.name}`,
    });

    return updated;
  }

  async removeDocument(user: AuthenticatedUser, companyId: string, documentId: string) {
    this.assertCompanyAccess(user, companyId);
    const document = await this.prisma.companyDocument.findFirst({
      where: { id: documentId, companyId, deletedAt: null },
    });
    if (!document) {
      throw new NotFoundException({ code: 'DOCUMENT_NOT_FOUND', message: 'Document not found for this company.' });
    }
    await this.prisma.companyDocument.update({
      where: { id: documentId },
      data: { deletedAt: new Date() },
    });
    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: 'CompanyDocument',
      entityId: documentId,
      actorId: user.id,
      actorEmail: user.email,
      description: `Removed ${document.type} document`,
    });
    return { id: documentId, deleted: true };
  }

  // ------------------------------------------------------------ statistics

  async statistics() {
    const [total, byStatus, byType, byRegion, withViolations] = await Promise.all([
      this.prisma.company.count({ where: { deletedAt: null } }),
      this.prisma.company.groupBy({ by: ['status'], where: { deletedAt: null }, _count: { _all: true } }),
      this.prisma.company.groupBy({ by: ['type'], where: { deletedAt: null }, _count: { _all: true } }),
      this.prisma.company.groupBy({
        by: ['region'],
        where: { deletedAt: null },
        _count: { _all: true },
        orderBy: { _count: { region: 'desc' } },
        take: 10,
      }),
      this.prisma.company.findMany({
        where: { deletedAt: null, violations: { some: { deletedAt: null } } },
        select: { id: true, name: true, _count: { select: { violations: true } } },
        orderBy: { violations: { _count: 'desc' } },
        take: 10,
      }),
    ]);

    return {
      total,
      byStatus: byStatus.map((row) => ({ status: row.status, count: row._count._all })),
      byType: byType.map((row) => ({ type: row.type, count: row._count._all })),
      byRegion: byRegion.map((row) => ({ region: row.region, count: row._count._all })),
      companiesWithViolations: withViolations.map((company) => ({
        id: company.id,
        name: company.name,
        violations: company._count.violations,
      })),
    };
  }
}
