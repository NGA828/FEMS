import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CompaniesService } from './companies.service';
import {
  CompanyDocumentQueryDto,
  CompanyQueryDto,
  CreateCompanyDocumentDto,
  CreateCompanyDto,
  SuspendCompanyDto,
  UpdateCompanyDto,
  VerifyCompanyDto,
  VerifyDocumentDto,
} from './dto/company.dto';
import { CurrentUser, RequireAnyPermission, RequirePermissions, type AuthenticatedUser } from '../common/decorators';
import { paginate } from '../common/dto/pagination.dto';

@ApiTags('companies')
@ApiBearerAuth('bearer')
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @RequireAnyPermission('companies:read', 'companies:read_own')
  @ApiOperation({
    summary: 'List companies',
    description:
      'Regulators (`companies:read`) see every company; a company representative only sees their own company.',
  })
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: CompanyQueryDto) {
    const { items, total } = await this.companies.list(user, query);
    return paginate(items, total, query.page, query.limit);
  }

  @Get('statistics')
  @RequirePermissions('companies:read')
  @ApiOperation({ summary: 'Company statistics by status, type and region' })
  statistics() {
    return this.companies.statistics();
  }

  @Get('me')
  @RequireAnyPermission('companies:read', 'companies:read_own')
  @ApiOperation({ summary: 'The company of the signed-in user (with documents and members)' })
  async myCompany(@CurrentUser() user: AuthenticatedUser) {
    if (!user.companyId) {
      throw new NotFoundException({
        code: 'COMPANY_NOT_LINKED',
        message: 'Your account is not linked to a company. Register a company or ask an administrator to link one.',
      });
    }
    return this.companies.findOne(user, user.companyId);
  }

  @Post()
  @RequirePermissions('companies:create')
  @ApiOperation({
    summary: 'Register a company',
    description: 'Administrators and officers may register companies on behalf of an operator. New companies start as PENDING.',
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCompanyDto) {
    return this.companies.create(user, dto);
  }

  @Get(':id')
  @RequireAnyPermission('companies:read', 'companies:read_own')
  @ApiOperation({ summary: 'Company detail with documents, members and permit summary' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.companies.findOne(user, id);
  }

  @Patch(':id')
  @RequirePermissions('companies:update')
  @ApiOperation({ summary: 'Update a company (company representatives can only update their own)' })
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateCompanyDto) {
    return this.companies.update(user, id, dto);
  }

  @Post(':id/verify')
  @RequirePermissions('companies:verify')
  @ApiOperation({
    summary: 'Verify or reject a company registration',
    description:
      'Requires at least one verified company document before approval. The decision, its author and the reason are recorded in the audit trail; no decision is ever automatic.',
  })
  verify(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: VerifyCompanyDto) {
    return this.companies.verify(user, id, dto);
  }

  @Post(':id/status')
  @RequirePermissions('companies:verify')
  @ApiOperation({ summary: 'Suspend, reject or restore a company' })
  updateStatus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: SuspendCompanyDto) {
    return this.companies.updateStatus(user, id, dto);
  }

  @Get(':id/documents')
  @RequireAnyPermission('companies:read', 'companies:read_own')
  @ApiOperation({ summary: 'List a company’s compliance documents' })
  async documents(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: CompanyDocumentQueryDto,
  ) {
    const { items, total } = await this.companies.listDocuments(user, id, query);
    return paginate(items, total, query.page, query.limit);
  }

  @Post(':id/documents')
  @RequirePermissions('companies:manage_documents')
  @ApiOperation({
    summary: 'Attach an uploaded document to a company',
    description: 'Upload the file through POST /files/upload?folder=companies/documents first, then attach the returned fileKey here.',
  })
  addDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateCompanyDocumentDto,
  ) {
    return this.companies.addDocument(user, id, dto);
  }

  @Patch(':id/documents/:documentId/verify')
  @RequirePermissions('companies:verify')
  @ApiOperation({ summary: 'Verify or un-verify a company document' })
  verifyDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Body() dto: VerifyDocumentDto,
  ) {
    return this.companies.verifyDocument(user, id, documentId, dto);
  }

  @Delete(':id/documents/:documentId')
  @RequirePermissions('companies:manage_documents')
  @ApiOperation({ summary: 'Remove a company document' })
  removeDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
  ) {
    return this.companies.removeDocument(user, id, documentId);
  }
}
