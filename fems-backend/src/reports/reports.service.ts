import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  NotificationType,
  PaymentPurpose,
  PaymentStatus,
  PermitStatus,
  Prisma,
  ReportFormat,
  ReportStatus,
  ReportType,
  ViolationStatus,
} from '@prisma/client';
import type { Readable } from 'node:stream';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { References, uniqueReference } from '../common/utils/reference.util';
import { parseJsonObject, stringifyJson } from '../common/utils/json.util';
import { resolveOrderBy } from '../common/dto/pagination.dto';
import { canReadAll } from '../common/utils/access-scope.util';
import type { AuthenticatedUser } from '../common/decorators';
import {
  ACTIVE_VIOLATION_STATUSES,
} from '../environmental/violation-state';
import {
  MAX_REPORT_ROWS,
  REPORT_CATALOGUE,
  REPORT_TYPES,
  capRows,
  describePeriod,
  reportDefinition,
  scoreCompliance,
  summarise,
  toCsv,
  type ReportColumn,
} from './report-datasets';
import { renderReportPdf } from './report-pdf';
import type { CreateReportDto, ReportQueryDto, SendReportDto } from './dto/report.dto';

interface Dataset {
  rows: Array<Record<string, unknown>>;
  columns: ReportColumn[];
  summary: Array<{ label: string; value: string }>;
  notes: string[];
  truncated: boolean;
  totalRows: number;
}

const DEFAULT_WINDOW_DAYS = 365;

const REPORT_INCLUDE = {
  forest: { select: { id: true, code: true, name: true } },
  company: { select: { id: true, name: true } },
  permit: { select: { id: true, permitNumber: true } },
  protectedArea: { select: { id: true, name: true } },
  generatedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
} satisfies Prisma.ReportInclude;

/**
 * Reports and exports.
 *
 * Every report is built from the live database with the caller's own scope
 * applied first, then rendered in the requested format (JSON, CSV and a real
 * paginated PDF) and stored like any other file. The row that describes the
 * report only reaches READY when the file it points at actually exists — a
 * failed generation is stored as FAILED with the reason.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  catalogue() {
    return {
      reportTypes: REPORT_TYPES.map((type) => {
        const definition = reportDefinition(type);
        return {
          type: definition.type,
          label: definition.label,
          description: definition.description,
          formats: definition.formats,
          columns: definition.columns,
        };
      }),
      formats: Object.values(ReportFormat),
      maxRows: MAX_REPORT_ROWS,
    };
  }

  async list(user: AuthenticatedUser, query: ReportQueryDto) {
    const where: Prisma.ReportWhereInput = {
      deletedAt: null,
      type: query.type,
      format: query.format,
      status: query.status,
      forestId: query.forestId,
      ...this.scope(user, query.companyId),
      createdAt:
        query.from || query.to
          ? { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined }
          : undefined,
      ...(query.search
        ? { OR: [{ reference: { contains: query.search } }, { title: { contains: query.search } }] }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.report.findMany({
        where,
        include: REPORT_INCLUDE,
        orderBy: resolveOrderBy(query.sortBy, query.sortOrder, ['createdAt', 'generatedAt', 'type'], 'createdAt'),
        skip: query.skip,
        take: query.limit,
      }),
      this.prisma.report.count({ where }),
    ]);

    return { items: items.map((item) => this.withSummary(item)), total };
  }

  async findOne(user: AuthenticatedUser, id: string) {
    const report = await this.prisma.report.findFirst({ where: { id, deletedAt: null }, include: REPORT_INCLUDE });
    if (!report) throw new NotFoundException({ code: 'REPORT_NOT_FOUND', message: 'Report not found.' });
    this.assertVisible(user, report);
    return this.withSummary(report);
  }

  /**
   * Builds the dataset behind a report type without storing anything — the
   * mobile app uses it to preview a report before generating the file.
   */
  async preview(user: AuthenticatedUser, dto: CreateReportDto) {
    const dataset = await this.buildDataset(user, {
      ...dto,
      format: dto.format ?? ReportFormat.JSON,
    });
    return {
      type: dto.type,
      title: this.titleFor(user, dto),
      columns: dataset.columns,
      summary: dataset.summary,
      notes: dataset.notes,
      rowCount: dataset.rows.length,
      totalRows: dataset.totalRows,
      truncated: dataset.truncated,
      rows: dataset.rows.slice(0, 50),
    };
  }

  async create(user: AuthenticatedUser, dto: CreateReportDto) {
    const format = dto.format ?? ReportFormat.PDF;
    const definition = reportDefinition(dto.type);
    if (!definition) {
      throw new BadRequestException({
        code: 'REPORT_TYPE_UNKNOWN',
        message: `Unknown report type. Expected one of: ${REPORT_TYPES.join(', ')}.`,
      });
    }

    const reference = await uniqueReference(
      () => References.report(dto.type),
      async (candidate) => (await this.prisma.report.count({ where: { reference: candidate } })) === 0,
    );

    const title = this.titleFor(user, dto);
    const parameters = {
      type: dto.type,
      format,
      from: dto.from ?? null,
      to: dto.to ?? null,
      forestId: dto.forestId ?? null,
      zoneId: dto.zoneId ?? null,
      protectedAreaId: dto.protectedAreaId ?? null,
      companyId: dto.companyId ?? null,
      permitId: dto.permitId ?? null,
      maxRows: dto.maxRows ?? MAX_REPORT_ROWS,
    };

    const report = await this.prisma.report.create({
      data: {
        reference,
        type: dto.type,
        format,
        status: ReportStatus.GENERATING,
        title,
        parametersJson: stringifyJson(parameters),
        dateFrom: dto.from ? new Date(dto.from) : null,
        dateTo: dto.to ? new Date(dto.to) : null,
        forestId: dto.forestId,
        zoneId: dto.zoneId,
        protectedAreaId: dto.protectedAreaId,
        companyId: user.companyId ?? dto.companyId,
        permitId: dto.permitId,
        generatedById: user.id,
      },
      include: REPORT_INCLUDE,
    });

    try {
      const dataset = await this.buildDataset(user, dto);
      const { buffer, mimeType, extension } = await this.render(format, {
        title,
        dataset,
        period: describePeriod(report.dateFrom, report.dateTo),
        generatedBy: `${user.firstName} ${user.lastName}`.trim() || user.email,
        organisation: await this.organisationName(),
      });

      const stored = await this.storage.save({
        buffer,
        originalName: `${reference}.${extension}`,
        mimeType,
        folder: 'reports/exports',
      });

      const ready = await this.prisma.report.update({
        where: { id: report.id },
        data: {
          status: ReportStatus.READY,
          summaryJson: stringifyJson({
            summary: dataset.summary,
            notes: dataset.notes,
            totals: summarise(dataset.columns, dataset.rows),
            rowCount: dataset.rows.length,
            totalRows: dataset.totalRows,
            truncated: dataset.truncated,
          }),
          fileKey: stored.fileKey,
          fileUrl: `/api/v1/files/download?key=${encodeURIComponent(stored.fileKey)}`,
          sizeBytes: stored.sizeBytes,
          generatedAt: new Date(),
          errorMessage: null,
        },
        include: REPORT_INCLUDE,
      });

      await this.audit.record({
        action: AuditAction.EXPORT,
        entityType: 'Report',
        entityId: ready.id,
        actorId: user.id,
        actorEmail: user.email,
        description: `Generated ${ready.type} report ${ready.reference} (${format}, ${dataset.rows.length} row(s))`,
        after: {
          type: ready.type,
          format,
          rowCount: dataset.rows.length,
          truncated: dataset.truncated,
          sizeBytes: stored.sizeBytes,
        },
      });

      await this.notifications.notify({
        userIds: [user.id],
        type: NotificationType.REPORT_READY,
        title: 'Report ready',
        message: `${ready.title} (${ready.reference}) is ready to download.`,
        entityType: 'Report',
        entityId: ready.id,
        actionUrl: `/reports/${ready.id}`,
      });

      return this.withSummary(ready);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown report generation error';
      this.logger.error(`Report ${reference} failed: ${message}`);
      await this.prisma.report.update({
        where: { id: report.id },
        data: { status: ReportStatus.FAILED, errorMessage: message.slice(0, 500) },
      });
      throw new InternalServerErrorException({
        code: 'REPORT_GENERATION_FAILED',
        message: `The report could not be generated: ${message}`,
        details: { reportId: report.id, reference },
      });
    }
  }

  /** Streams the generated file back to an authorised caller. */
  async download(user: AuthenticatedUser, id: string): Promise<{ stream: Readable; report: { reference: string; format: ReportFormat; title: string } }> {
    const report = await this.prisma.report.findFirst({ where: { id, deletedAt: null }, include: REPORT_INCLUDE });
    if (!report) throw new NotFoundException({ code: 'REPORT_NOT_FOUND', message: 'Report not found.' });
    this.assertVisible(user, report);
    if (report.status !== ReportStatus.READY || !report.fileKey) {
      throw new ConflictException({
        code: 'REPORT_NOT_READY',
        message:
          report.status === ReportStatus.FAILED
            ? `This report failed to generate: ${report.errorMessage ?? 'unknown error'}.`
            : 'This report is still generating.',
      });
    }

    this.storage.getMetadata(report.fileKey);
    await this.audit.record({
      action: AuditAction.EXPORT,
      entityType: 'Report',
      entityId: report.id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Downloaded report ${report.reference} (${report.format})`,
    });

    return {
      stream: this.storage.createReadStream(report.fileKey),
      report: { reference: report.reference, format: report.format, title: report.title },
    };
  }

  /** Shares a ready report with the officers or with the companies it concerns. */
  async send(user: AuthenticatedUser, id: string, dto: SendReportDto) {
    const report = await this.prisma.report.findFirst({ where: { id, deletedAt: null }, include: REPORT_INCLUDE });
    if (!report) throw new NotFoundException({ code: 'REPORT_NOT_FOUND', message: 'Report not found.' });
    this.assertVisible(user, report);
    if (report.status !== ReportStatus.READY) {
      throw new ConflictException({
        code: 'REPORT_NOT_READY',
        message: 'Only a successfully generated report can be shared.',
      });
    }

    const audience = dto.audience ?? 'OFFICERS';
    const message = dto.message ?? `${report.title} (${report.reference}) is available in FEMS.`;

    if (audience === 'COMPANIES') {
      const companies = report.companyId
        ? [{ id: report.companyId }]
        : await this.prisma.company.findMany({ where: { deletedAt: null, status: 'VERIFIED' }, select: { id: true } });
      let delivered = 0;
      for (const company of companies) {
        const users = await this.prisma.user.findMany({
          where: { companyId: company.id, deletedAt: null, status: 'ACTIVE' },
          select: { id: true },
        });
        if (users.length === 0) continue;
        // eslint-disable-next-line no-await-in-loop
        const result = await this.notifications.notify({
          userIds: users.map((member) => member.id),
          type: NotificationType.REPORT_READY,
          title: 'Report shared with your company',
          message,
          entityType: 'Report',
          entityId: report.id,
          actionUrl: `/reports/${report.id}`,
        });
        delivered += result.created;
      }
      await this.audit.record({
        action: AuditAction.EXPORT,
        entityType: 'Report',
        entityId: report.id,
        actorId: user.id,
        actorEmail: user.email,
        description: `Shared report ${report.reference} with ${companies.length} company account(s)`,
        after: { audience, delivered },
      });
      return { report: this.withSummary(report), audience, companies: companies.length, delivered };
    }

    const result = await this.notifications.notifyRoles(['GOVERNMENT_FOREST_OFFICER', 'ENVIRONMENTAL_OFFICER', 'FOREST_INSPECTOR'], {
      type: NotificationType.REPORT_READY,
      title: 'Report shared with the services',
      message,
      entityType: 'Report',
      entityId: report.id,
      actionUrl: `/reports/${report.id}`,
    });
    await this.audit.record({
      action: AuditAction.EXPORT,
      entityType: 'Report',
      entityId: report.id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Shared report ${report.reference} with the inspection services`,
      after: { audience, delivered: result.created },
    });
    return { report: this.withSummary(report), audience, companies: 0, delivered: result.created };
  }

  async remove(user: AuthenticatedUser, id: string) {
    const report = await this.prisma.report.findFirst({ where: { id, deletedAt: null } });
    if (!report) throw new NotFoundException({ code: 'REPORT_NOT_FOUND', message: 'Report not found.' });
    this.assertVisible(user, report);

    if (report.fileKey) {
      try {
        await this.storage.remove(report.fileKey);
      } catch (error) {
        this.logger.warn(`Could not delete the file of report ${report.reference}: ${(error as Error).message}`);
      }
    }

    await this.prisma.report.update({
      where: { id },
      data: { deletedAt: new Date(), status: ReportStatus.DRAFT },
    });

    await this.audit.record({
      action: AuditAction.DELETE,
      entityType: 'Report',
      entityId: id,
      actorId: user.id,
      actorEmail: user.email,
      description: `Deleted report ${report.reference} (${report.type})`,
    });

    return { id, deleted: true };
  }

  async statistics(user: AuthenticatedUser) {
    const where: Prisma.ReportWhereInput = { deletedAt: null, ...this.scope(user) };
    const [byType, byFormat, byStatus, totals] = await Promise.all([
      this.prisma.report.groupBy({ by: ['type'], where, _count: { _all: true } }),
      this.prisma.report.groupBy({ by: ['format'], where, _count: { _all: true } }),
      this.prisma.report.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.report.aggregate({ where, _count: { _all: true }, _sum: { sizeBytes: true }, _max: { generatedAt: true } }),
    ]);

    const perDefinition = REPORT_TYPES.map((type) => {
      const definition = reportDefinition(type);
      const stored = byType.find((row) => row.type === type)?._count._all ?? 0;
      return { type, label: definition.label, generated: stored, description: definition.description };
    });

    return {
      total: totals._count._all,
      totalSizeBytes: Number(totals._sum.sizeBytes ?? 0),
      lastGeneratedAt: totals._max.generatedAt,
      byType: perDefinition,
      byFormat: byFormat.map((row) => ({ format: row.format, count: row._count._all })),
      byStatus: byStatus.map((row) => ({ status: row.status, count: row._count._all })),
    };
  }

  // -------------------------------------------------------------- datasets

  private async buildDataset(user: AuthenticatedUser, dto: CreateReportDto): Promise<Dataset> {
    const from = dto.from ? new Date(dto.from) : new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000);
    const to = dto.to ? new Date(dto.to) : new Date();
    if (from > to) {
      throw new BadRequestException({
        code: 'REPORT_PERIOD_INVALID',
        message: 'The start of the reporting period is after its end.',
      });
    }

    // A company account can only ever report on its own records.
    const companyId = user.companyId ?? dto.companyId;
    const scope = { forestId: dto.forestId, zoneId: dto.zoneId, protectedAreaId: dto.protectedAreaId, companyId, permitId: dto.permitId };

    switch (dto.type) {
      case ReportType.PERMITS:
        return this.permitDataset(from, to, scope);
      case ReportType.EXPLOITATION_ACTIVITIES:
        return this.activityDataset(from, to, scope);
      case ReportType.PAYMENTS:
        return this.paymentDataset(from, to, scope);
      case ReportType.INSPECTIONS:
        return this.inspectionDataset(from, to, scope);
      case ReportType.ENVIRONMENTAL_VIOLATIONS:
        return this.violationDataset(from, to, scope);
      case ReportType.FOREST_ACTIVITIES:
        return this.forestDataset(from, to, scope);
      case ReportType.COMPLIANCE_SUMMARY:
        return this.complianceDataset(from, to, scope);
      case ReportType.AI_ALERTS:
        return this.alertDataset(from, to, scope);
      default:
        throw new BadRequestException({
          code: 'REPORT_TYPE_UNKNOWN',
          message: `Unknown report type. Expected one of: ${REPORT_TYPES.join(', ')}.`,
        });
    }
  }

  private money(value: Prisma.Decimal | number | null): number {
    return value === null ? 0 : Math.round(Number(value) * 100) / 100;
  }

  private async permitDataset(
    from: Date,
    to: Date,
    scope: { forestId?: string; zoneId?: string; companyId?: string; permitId?: string },
  ): Promise<Dataset> {
    const permits = await this.prisma.exploitationPermit.findMany({
      where: {
        deletedAt: null,
        id: scope.permitId,
        forestId: scope.forestId,
        zoneId: scope.zoneId,
        companyId: scope.companyId,
        // Permits whose validity overlaps the reported period.
        startDate: { lte: to },
        endDate: { gte: from },
      },
      include: {
        company: { select: { name: true } },
        forest: { select: { name: true } },
        payments: { where: { status: PaymentStatus.SUCCESSFUL }, select: { amount: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_REPORT_ROWS + 1,
    });

    const rows = permits.map((permit) => {
      const paid = permit.payments.reduce((sum, payment) => sum + this.money(payment.amount), 0);
      return {
        permitNumber: permit.permitNumber,
        type: permit.type,
        title: permit.title,
        companyName: permit.company?.name ?? '—',
        forestName: permit.forest.name,
        status: permit.status,
        volumeApprovedM3: permit.volumeApprovedM3 === null ? 0 : this.money(permit.volumeApprovedM3),
        feeAmount: this.money(permit.feeAmount),
        outstandingBalance: Math.max(0, Math.round((this.money(permit.feeAmount) - paid) * 100) / 100),
        startDate: permit.startDate,
        endDate: permit.endDate,
      };
    });

    const byStatus = new Map<string, number>();
    for (const row of rows) byStatus.set(String(row.status), (byStatus.get(String(row.status)) ?? 0) + 1);
    const totals = summarise(reportDefinition(ReportType.PERMITS).columns, rows);

    return {
      rows,
      columns: reportDefinition(ReportType.PERMITS).columns,
      summary: [
        { label: 'Permits in period', value: String(rows.length) },
        { label: 'Approved volume', value: `${totals.volumeApprovedM3 ?? 0} m³` },
        { label: 'Fees invoiced', value: `${totals.feeAmount ?? 0} XAF` },
        { label: 'Fees outstanding', value: `${totals.outstandingBalance ?? 0} XAF` },
        { label: 'Active', value: String(byStatus.get(PermitStatus.ACTIVE) ?? 0) },
        { label: 'Awaiting payment / review', value: String((byStatus.get(PermitStatus.PAYMENT_PENDING) ?? 0) + (byStatus.get(PermitStatus.UNDER_REVIEW) ?? 0)) },
      ],
      notes: [`Validity overlapping ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`],
      truncated: rows.length > MAX_REPORT_ROWS,
      totalRows: rows.length,
    };
  }

  private async activityDataset(
    from: Date,
    to: Date,
    scope: { forestId?: string; zoneId?: string; companyId?: string; permitId?: string },
  ): Promise<Dataset> {
    const activities = await this.prisma.exploitationActivity.findMany({
      where: {
        deletedAt: null,
        permitId: scope.permitId,
        forestId: scope.forestId,
        zoneId: scope.zoneId,
        companyId: scope.companyId,
        plannedStartDate: { gte: from, lte: to },
      },
      include: {
        permit: { select: { permitNumber: true } },
        company: { select: { name: true } },
        forest: { select: { name: true } },
      },
      orderBy: { plannedStartDate: 'desc' },
      take: MAX_REPORT_ROWS + 1,
    });

    const rows = activities.map((activity) => ({
      reference: activity.reference,
      activityType: activity.activityType,
      permitNumber: activity.permit.permitNumber,
      companyName: activity.company.name,
      forestName: activity.forest.name,
      status: activity.status,
      plannedVolumeM3: this.money(activity.plannedVolumeM3),
      harvestedVolumeM3: this.money(activity.harvestedVolumeM3),
      harvestedTreeCount: activity.harvestedTreeCount,
      plannedStartDate: activity.plannedStartDate,
    }));

    const totals = summarise(reportDefinition(ReportType.EXPLOITATION_ACTIVITIES).columns, rows);
    const overHarvest = rows.filter((row) => Number(row.harvestedVolumeM3) > Number(row.plannedVolumeM3)).length;

    return {
      rows,
      columns: reportDefinition(ReportType.EXPLOITATION_ACTIVITIES).columns,
      summary: [
        { label: 'Activities', value: String(rows.length) },
        { label: 'Planned volume', value: `${totals.plannedVolumeM3 ?? 0} m³` },
        { label: 'Harvested volume', value: `${totals.harvestedVolumeM3 ?? 0} m³` },
        { label: 'Trees felled', value: String(totals.harvestedTreeCount ?? 0) },
        { label: 'Activities above plan', value: String(overHarvest) },
        { label: 'Completed', value: String(rows.filter((row) => row.status === 'COMPLETED').length) },
      ],
      notes: [
        'Harvested volumes are the figures declared and recorded in the field; they are verified by inspection, not accepted as final.',
      ],
      truncated: rows.length > MAX_REPORT_ROWS,
      totalRows: rows.length,
    };
  }

  private async paymentDataset(
    from: Date,
    to: Date,
    scope: { companyId?: string; permitId?: string },
  ): Promise<Dataset> {
    const payments = await this.prisma.payment.findMany({
      where: {
        permitId: scope.permitId,
        companyId: scope.companyId,
        initiatedAt: { gte: from, lte: to },
      },
      include: {
        company: { select: { name: true } },
        permit: { select: { permitNumber: true } },
      },
      orderBy: { initiatedAt: 'desc' },
      take: MAX_REPORT_ROWS + 1,
    });

    const rows = payments.map((payment) => ({
      reference: payment.reference,
      purpose: payment.purpose,
      status: payment.status,
      method: payment.method ?? '—',
      amount: this.money(payment.amount),
      currency: payment.currency,
      companyName: payment.company?.name ?? '—',
      permitNumber: payment.permit?.permitNumber ?? '—',
      receiptNumber: payment.receiptNumber ?? '—',
      paidAt: payment.paidAt,
    }));

    const settled = rows.filter((row) => row.status === PaymentStatus.SUCCESSFUL);
    const collected = settled.reduce((sum, row) => sum + Number(row.amount), 0);
    const byPurpose = new Map<string, number>();
    for (const row of settled) byPurpose.set(String(row.purpose), (byPurpose.get(String(row.purpose)) ?? 0) + Number(row.amount));

    return {
      rows,
      columns: reportDefinition(ReportType.PAYMENTS).columns,
      summary: [
        { label: 'Payments recorded', value: String(rows.length) },
        { label: 'Settled', value: String(settled.length) },
        { label: 'Amount collected', value: `${Math.round(collected * 100) / 100} XAF` },
        { label: 'Permit fees collected', value: `${Math.round((byPurpose.get(PaymentPurpose.PERMIT_FEE) ?? 0) * 100) / 100} XAF` },
        { label: 'Penalties collected', value: `${Math.round((byPurpose.get(PaymentPurpose.PENALTY) ?? 0) * 100) / 100} XAF` },
        {
          label: 'Awaiting settlement',
          value: `${rows.filter((row) => row.status === PaymentStatus.PENDING || row.status === PaymentStatus.PROCESSING).length}`,
        },
      ],
      notes: [
        'Only payments the provider confirmed as successful are counted as collected; pending and failed attempts are listed but not summed.',
      ],
      truncated: rows.length > MAX_REPORT_ROWS,
      totalRows: rows.length,
    };
  }

  private async inspectionDataset(
    from: Date,
    to: Date,
    scope: { forestId?: string; zoneId?: string; companyId?: string; permitId?: string },
  ): Promise<Dataset> {
    const inspections = await this.prisma.inspection.findMany({
      where: {
        deletedAt: null,
        forestId: scope.forestId,
        zoneId: scope.zoneId,
        companyId: scope.companyId,
        permitId: scope.permitId,
        OR: [
          { submittedAt: { gte: from, lte: to } },
          { submittedAt: null, scheduledFor: { gte: from, lte: to } },
          { submittedAt: null, scheduledFor: null, createdAt: { gte: from, lte: to } },
        ],
      },
      include: {
        forest: { select: { name: true } },
        company: { select: { name: true } },
        inspector: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_REPORT_ROWS + 1,
    });

    const rows = inspections.map((inspection) => ({
      reference: inspection.reference,
      type: inspection.type,
      status: inspection.status,
      outcome: inspection.outcome ?? '—',
      complianceScore: inspection.complianceScore ?? 0,
      forestName: inspection.forest.name,
      companyName: inspection.company?.name ?? '—',
      inspectorName: `${inspection.inspector.firstName} ${inspection.inspector.lastName}`.trim(),
      distanceFromTargetM: inspection.distanceFromTargetM === null ? 0 : this.money(inspection.distanceFromTargetM),
      submittedAt: inspection.submittedAt,
    }));

    const scored = rows.filter((row) => Number(row.complianceScore) > 0);
    const average = scored.length
      ? Math.round(scored.reduce((sum, row) => sum + Number(row.complianceScore), 0) / scored.length)
      : null;

    return {
      rows,
      columns: reportDefinition(ReportType.INSPECTIONS).columns,
      summary: [
        { label: 'Inspections', value: String(rows.length) },
        { label: 'Submitted', value: String(rows.filter((row) => row.status !== 'SCHEDULED' && row.status !== 'IN_PROGRESS').length) },
        { label: 'Average compliance', value: average === null ? 'no scored report' : `${average}%` },
        { label: 'Non-compliance found', value: String(rows.filter((row) => row.outcome && row.outcome !== 'COMPLIANT').length) },
        { label: 'Closed', value: String(rows.filter((row) => row.status === 'CLOSED').length) },
        { label: 'Cancelled', value: String(rows.filter((row) => row.status === 'CANCELLED').length) },
      ],
      notes: rows.some((row) => row.distanceFromTargetM !== 0)
        ? ['Distance is measured between the GPS position captured on site and the inspected activity position.']
        : [],
      truncated: rows.length > MAX_REPORT_ROWS,
      totalRows: rows.length,
    };
  }

  private async violationDataset(
    from: Date,
    to: Date,
    scope: { forestId?: string; zoneId?: string; companyId?: string; permitId?: string; protectedAreaId?: string },
  ): Promise<Dataset> {
    const violations = await this.prisma.environmentalViolation.findMany({
      where: {
        deletedAt: null,
        forestId: scope.forestId,
        zoneId: scope.zoneId,
        protectedAreaId: scope.protectedAreaId,
        companyId: scope.companyId,
        permitId: scope.permitId,
        detectedAt: { gte: from, lte: to },
      },
      include: {
        company: { select: { name: true } },
        forest: { select: { name: true } },
        payments: { where: { status: PaymentStatus.SUCCESSFUL }, select: { amount: true } },
      },
      orderBy: { detectedAt: 'desc' },
      take: MAX_REPORT_ROWS + 1,
    });

    const rows = violations.map((violation) => ({
      reference: violation.reference,
      title: violation.title,
      severity: violation.severity,
      status: violation.status,
      companyName: violation.company?.name ?? '—',
      forestName: violation.forest.name,
      estimatedDamageXAF: this.money(violation.estimatedDamageXAF),
      penaltyAmountXAF: this.money(violation.penaltyAmountXAF),
      penaltyPaidXAF: violation.payments.reduce((sum, payment) => sum + this.money(payment.amount), 0),
      remediationDeadline: violation.remediationDeadline,
      detectedAt: violation.detectedAt,
    }));

    const totals = summarise(reportDefinition(ReportType.ENVIRONMENTAL_VIOLATIONS).columns, rows);
    const open = rows.filter((row) => ACTIVE_VIOLATION_STATUSES.includes(row.status as ViolationStatus));

    return {
      rows,
      columns: reportDefinition(ReportType.ENVIRONMENTAL_VIOLATIONS).columns,
      summary: [
        { label: 'Cases opened', value: String(rows.length) },
        { label: 'Open cases', value: String(open.length) },
        { label: 'Confirmed', value: String(rows.filter((row) => row.status === ViolationStatus.CONFIRMED || row.status === ViolationStatus.ESCALATED).length) },
        { label: 'Assessed damage', value: `${totals.estimatedDamageXAF ?? 0} XAF` },
        { label: 'Penalties decided', value: `${totals.penaltyAmountXAF ?? 0} XAF` },
        { label: 'Penalties collected', value: `${totals.penaltyPaidXAF ?? 0} XAF` },
      ],
      notes: [
        'Every case is opened by an officer from documented field evidence. Automated analysis may point at a site, but never opens a case.',
      ],
      truncated: rows.length > MAX_REPORT_ROWS,
      totalRows: rows.length,
    };
  }

  private async forestDataset(
    from: Date,
    to: Date,
    scope: { forestId?: string },
  ): Promise<Dataset> {
    const forests = await this.prisma.forest.findMany({
      where: { deletedAt: null, id: scope.forestId },
      include: {
        zones: { where: { deletedAt: null }, select: { id: true } },
        activities: { where: { deletedAt: null, plannedStartDate: { gte: from, lte: to } }, select: { harvestedVolumeM3: true } },
        inspections: { where: { deletedAt: null, OR: [{ submittedAt: { gte: from, lte: to } }, { submittedAt: null, createdAt: { gte: from, lte: to } }] }, select: { id: true } },
        violations: { where: { deletedAt: null, detectedAt: { gte: from, lte: to } }, select: { id: true } },
      },
      orderBy: { code: 'asc' },
      take: MAX_REPORT_ROWS + 1,
    });

    const rows = forests.map((forest) => ({
      forestCode: forest.code,
      forestName: forest.name,
      region: forest.region,
      zoneCount: forest.zones.length,
      areaHa: this.money(forest.totalAreaHa),
      activityCount: forest.activities.length,
      harvestedVolumeM3: forest.activities.reduce((sum, activity) => sum + this.money(activity.harvestedVolumeM3), 0),
      inspectionCount: forest.inspections.length,
      violationCount: forest.violations.length,
    }));

    const totals = summarise(reportDefinition(ReportType.FOREST_ACTIVITIES).columns, rows);

    return {
      rows,
      columns: reportDefinition(ReportType.FOREST_ACTIVITIES).columns,
      summary: [
        { label: 'Forests', value: String(rows.length) },
        { label: 'Area under management', value: `${totals.areaHa ?? 0} ha` },
        { label: 'Activities in period', value: String(totals.activityCount ?? 0) },
        { label: 'Volume harvested', value: `${totals.harvestedVolumeM3 ?? 0} m³` },
        { label: 'Inspections', value: String(totals.inspectionCount ?? 0) },
        { label: 'Cases opened', value: String(totals.violationCount ?? 0) },
      ],
      notes: [],
      truncated: rows.length > MAX_REPORT_ROWS,
      totalRows: rows.length,
    };
  }

  private async complianceDataset(
    from: Date,
    to: Date,
    scope: { companyId?: string; forestId?: string },
  ): Promise<Dataset> {
    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null, id: scope.companyId },
      select: { id: true, name: true, status: true },
      orderBy: { name: 'asc' },
      take: MAX_REPORT_ROWS + 1,
    });

    const rows: Array<Record<string, unknown>> = [];
    for (const company of companies) {
      const permitScope = { companyId: company.id, forestId: scope.forestId, deletedAt: null } as const;

      // eslint-disable-next-line no-await-in-loop
      const [activePermits, activities, inspections, violations, penalties, overdueRemediation] = await Promise.all([
        this.prisma.exploitationPermit.count({ where: { ...permitScope, status: PermitStatus.ACTIVE } }),
        this.prisma.exploitationActivity.aggregate({
          where: { ...permitScope, plannedStartDate: { gte: from, lte: to } },
          _sum: { harvestedVolumeM3: true },
        }),
        this.prisma.inspection.findMany({
          where: { ...permitScope, outcome: { not: null } },
          select: { complianceScore: true },
        }),
        this.prisma.environmentalViolation.groupBy({
          by: ['status'],
          where: { companyId: company.id, forestId: scope.forestId, deletedAt: null },
          _count: { _all: true },
        }),
        this.prisma.payment.aggregate({
          where: { companyId: company.id, status: PaymentStatus.SUCCESSFUL, purpose: PaymentPurpose.PENALTY },
          _sum: { amount: true },
        }),
        this.prisma.environmentalViolation.count({
          where: {
            companyId: company.id,
            forestId: scope.forestId,
            deletedAt: null,
            remediationRequired: true,
            remediationDeadline: { lt: new Date() },
            status: { in: ACTIVE_VIOLATION_STATUSES },
          },
        }),
      ]);

      const countOf = (status: ViolationStatus) => violations.find((row) => row.status === status)?._count._all ?? 0;
      const openViolations = ACTIVE_VIOLATION_STATUSES.reduce((sum, status) => sum + countOf(status), 0);
      const confirmedViolations = countOf(ViolationStatus.CONFIRMED) + countOf(ViolationStatus.ESCALATED);
      const scored = inspections.filter((inspection) => inspection.complianceScore !== null);
      const averageComplianceScore = scored.length
        ? Math.round(scored.reduce((sum, inspection) => sum + Number(inspection.complianceScore ?? 0), 0) / scored.length)
        : null;

      const penaltiesDecided = await this.prisma.environmentalViolation.aggregate({
        where: { companyId: company.id, forestId: scope.forestId, deletedAt: null },
        _sum: { penaltyAmountXAF: true },
      });
      const penaltiesOutstandingXAF = Math.max(
        0,
        Math.round((this.money(penaltiesDecided._sum.penaltyAmountXAF) - this.money(penalties._sum.amount)) * 100) / 100,
      );

      const score = scoreCompliance({
        confirmedViolations,
        openViolations,
        remediationOverdue: overdueRemediation,
        inspectionsCompleted: scored.length,
        averageComplianceScore,
      });

      rows.push({
        companyId: company.id,
        companyName: company.name,
        companyStatus: company.status,
        activePermits,
        harvestedVolumeM3: this.money(activities._sum.harvestedVolumeM3),
        inspectionsCompleted: scored.length,
        averageComplianceScore: averageComplianceScore ?? 0,
        openViolations,
        confirmedViolations,
        penaltiesOutstandingXAF,
        remediationOverdue: overdueRemediation,
        score: score.score,
        rating: score.rating,
        factors: score.factors,
      });
    }

    const byRating = new Map<string, number>();
    for (const row of rows) byRating.set(String(row.rating), (byRating.get(String(row.rating)) ?? 0) + 1);
    const rated = rows.map((row) => Number(row.score));
    const averageScore = rated.length ? Math.round(rated.reduce((sum, value) => sum + value, 0) / rated.length) : null;

    return {
      rows: rows.sort((a, b) => Number(a.score) - Number(b.score)),
      columns: reportDefinition(ReportType.COMPLIANCE_SUMMARY).columns,
      summary: [
        { label: 'Companies assessed', value: String(rows.length) },
        { label: 'Average score', value: averageScore === null ? 'n/a' : `${averageScore}/100` },
        { label: 'Compliant', value: String(byRating.get('COMPLIANT') ?? 0) },
        { label: 'Minor non-compliance', value: String(byRating.get('MINOR_NON_COMPLIANCE') ?? 0) },
        { label: 'Major non-compliance', value: String(byRating.get('MAJOR_NON_COMPLIANCE') ?? 0) },
        { label: 'Critical', value: String(byRating.get('CRITICAL_NON_COMPLIANCE') ?? 0) },
      ],
      notes: [
        'The score is a decision aid computed from recorded facts (permits, inspections, cases, penalties). It is not a regulatory decision and never replaces an inspection.',
        'Deductions: confirmed case −15 (max 45), overdue remediation −10 (max 20), open case −5 (max 15), low inspection compliance −shortfall/4 (max 25).',
      ],
      truncated: rows.length > MAX_REPORT_ROWS,
      totalRows: rows.length,
    };
  }

  private async alertDataset(
    from: Date,
    to: Date,
    scope: { forestId?: string; companyId?: string; permitId?: string; protectedAreaId?: string },
  ): Promise<Dataset> {
    const alerts = await this.prisma.aIAlert.findMany({
      where: {
        forestId: scope.forestId,
        companyId: scope.companyId,
        permitId: scope.permitId,
        protectedAreaId: scope.protectedAreaId,
        detectedAt: { gte: from, lte: to },
      },
      include: {
        forest: { select: { name: true } },
        company: { select: { name: true } },
        reviewedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { detectedAt: 'desc' },
      take: MAX_REPORT_ROWS + 1,
    });

    const rows = alerts.map((alert) => ({
      reference: alert.reference,
      type: alert.type,
      riskLevel: alert.riskLevel,
      status: alert.status,
      confidence: alert.confidence === null ? 0 : Number(alert.confidence),
      detector: alert.detector,
      forestName: alert.forest?.name ?? '—',
      companyName: alert.company?.name ?? '—',
      reviewedByName: alert.reviewedBy ? `${alert.reviewedBy.firstName} ${alert.reviewedBy.lastName}`.trim() : '—',
      detectedAt: alert.detectedAt,
      resolutionAction: alert.resolutionAction ?? '—',
    }));

    const reviewed = rows.filter((row) => row.status !== 'NEW');

    return {
      rows,
      columns: reportDefinition(ReportType.AI_ALERTS).columns,
      summary: [
        { label: 'Alerts raised', value: String(rows.length) },
        { label: 'Awaiting review', value: String(rows.length - reviewed.length) },
        { label: 'Confirmed by an officer', value: String(rows.filter((row) => row.status === 'CONFIRMED').length) },
        { label: 'Dismissed', value: String(rows.filter((row) => row.status === 'DISMISSED').length) },
        { label: 'Resolved', value: String(rows.filter((row) => row.status === 'RESOLVED').length) },
        { label: 'Detected by Gemini', value: String(rows.filter((row) => row.detector === 'GEMINI').length) },
      ],
      notes: [
        'An alert is a signal, not a finding: only the review status recorded by an officer gives it any regulatory effect.',
      ],
      truncated: rows.length > MAX_REPORT_ROWS,
      totalRows: rows.length,
    };
  }

  // -------------------------------------------------------------- rendering

  private async render(
    format: ReportFormat,
    input: {
      title: string;
      dataset: Dataset;
      period: string;
      generatedBy: string;
      organisation: string;
    },
  ): Promise<{ buffer: Buffer; mimeType: string; extension: string }> {
    const { dataset } = input;
    const capped = capRows(dataset.rows.length > MAX_REPORT_ROWS ? dataset.rows.slice(0, MAX_REPORT_ROWS) : dataset.rows);

    if (format === ReportFormat.JSON) {
      const payload = {
        report: input.title,
        organisation: input.organisation,
        period: input.period,
        generatedBy: input.generatedBy,
        generatedAt: new Date().toISOString(),
        columns: dataset.columns,
        summary: dataset.summary,
        notes: dataset.notes,
        rowCount: capped.rows.length,
        totalRows: capped.totalRows,
        truncated: capped.truncated,
        rows: capped.rows,
      };
      return { buffer: Buffer.from(JSON.stringify(payload, null, 2), 'utf8'), mimeType: 'application/json', extension: 'json' };
    }

    if (format === ReportFormat.CSV) {
      // A comment header keeps the machine-readable part intact while recording
      // where the numbers come from.
      const header = [
        `# ${input.title}`,
        `# Organisation: ${input.organisation}`,
        `# Period: ${input.period}`,
        `# Generated: ${new Date().toISOString()} by ${input.generatedBy}`,
        ...(capped.truncated ? [`# Truncated to the first ${MAX_REPORT_ROWS} of ${capped.totalRows} rows`] : []),
      ].join('\r\n');
      return {
        buffer: Buffer.from(`${header}\r\n${toCsv(dataset.columns, capped.rows)}\r\n`, 'utf8'),
        mimeType: 'text/csv',
        extension: 'csv',
      };
    }

    const buffer = await renderReportPdf({
      title: input.title,
      organisation: input.organisation,
      period: input.period,
      generatedBy: input.generatedBy,
      generatedAt: new Date(),
      summary: dataset.summary,
      notes: dataset.notes,
      columns: dataset.columns,
      rows: capped.rows,
      truncated: capped.truncated,
      totalRows: capped.totalRows,
    });
    return { buffer, mimeType: 'application/pdf', extension: 'pdf' };
  }

  // ----------------------------------------------------------------- helpers

  private titleFor(user: AuthenticatedUser, dto: CreateReportDto): string {
    if (dto.title) return dto.title;
    const label = REPORT_CATALOGUE[dto.type]?.label ?? 'Report';
    const scope = dto.companyId && !user.companyId ? ' — selected company' : '';
    const period = describePeriod(dto.from ? new Date(dto.from) : null, dto.to ? new Date(dto.to) : null);
    return `${label} — ${period}${scope}`.slice(0, 191);
  }

  private async organisationName(): Promise<string> {
    const setting = await this.prisma.systemSetting.findFirst({
      where: { key: 'organization.name' },
      select: { value: true },
    });
    return setting?.value ?? 'Ministère des Forêts et de la Faune — FEMS';
  }

  private withSummary<T extends { summaryJson?: string | null }>(report: T) {
    const parsed = parseJsonObject<{
      summary?: Array<{ label: string; value: string }>;
      notes?: string[];
      totals?: Record<string, number>;
      rowCount?: number;
      totalRows?: number;
      truncated?: boolean;
    }>(report.summaryJson ?? null);
    return {
      ...report,
      summary: parsed?.summary ?? [],
      notes: parsed?.notes ?? [],
      totals: parsed?.totals ?? {},
      rowCount: parsed?.rowCount ?? 0,
      totalRows: parsed?.totalRows ?? 0,
      truncated: parsed?.truncated ?? false,
    };
  }

  private scope(user: AuthenticatedUser, companyId?: string): Prisma.ReportWhereInput {
    if (user.companyId && !user.permissions.includes('*')) {
      return { companyId: user.companyId };
    }
    if (canReadAll(user, 'reports')) {
      return { companyId, generatedById: undefined };
    }
    return { OR: [{ generatedById: user.id }, { companyId: companyId ?? '__none__' }] };
  }

  private assertVisible(
    user: AuthenticatedUser,
    report: { generatedById: string; companyId: string | null },
  ): void {
    if (user.companyId && !user.permissions.includes('*')) {
      if (report.companyId === user.companyId) return;
      throw new ForbiddenException({
        code: 'REPORT_FORBIDDEN',
        message: 'This report concerns another organisation.',
      });
    }
    if (canReadAll(user, 'reports')) return;
    if (report.generatedById === user.id) return;
    throw new ForbiddenException({
      code: 'REPORT_FORBIDDEN',
      message: 'This report was generated by another account.',
    });
  }
}
