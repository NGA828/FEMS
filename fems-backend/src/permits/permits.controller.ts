import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PermitsService } from './permits.service';
import {
  CreatePermitDocumentDto,
  CreatePermitDto,
  PermitDecisionDto,
  PermitDocumentQueryDto,
  PermitQueryDto,
  RenewPermitDto,
  UpdatePermitDto,
  VerifyPermitDocumentDto,
} from './dto/permit.dto';
import { CurrentUser, RequireAnyPermission, RequirePermissions, type AuthenticatedUser } from '../common/decorators';
import { paginate } from '../common/dto/pagination.dto';
import { PERMIT_TRANSITIONS, type PermitAction } from './permit-state';
import { PERMIT_ACTIONS } from './permit-actions.const';

@ApiTags('permits')
@ApiBearerAuth('bearer')
@Controller('permits')
export class PermitsController {
  constructor(private readonly permits: PermitsService) {}

  @Get()
  @RequireAnyPermission('permits:read', 'permits:read_own')
  @ApiOperation({
    summary: 'List exploitation permits',
    description:
      'Regulators (`permits:read`) see every permit; a company account only sees the permits of its own company and the applications it filed itself.',
  })
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: PermitQueryDto) {
    const { items, total } = await this.permits.list(user, query);
    return paginate(items, total, query.page, query.limit);
  }

  @Get('statistics')
  @RequireAnyPermission('permits:read', 'permits:read_own')
  @ApiOperation({ summary: 'Permit statistics for the caller’s scope (statuses, volumes, fees, expiring permits)' })
  statistics(@CurrentUser() user: AuthenticatedUser) {
    return this.permits.statistics(user);
  }

  @Get('expiring')
  @RequireAnyPermission('permits:read', 'permits:read_own')
  @ApiQuery({ name: 'days', required: false, example: 30 })
  @ApiOperation({ summary: 'Permits expiring within the next N days (default 30)' })
  expiring(@Query('days') days = '30') {
    const parsed = Number.parseInt(days, 10);
    return this.permits.findExpiring(Number.isFinite(parsed) && parsed > 0 ? parsed : 30);
  }

  @Get('lifecycle')
  @RequirePermissions('permits:review')
  @ApiOperation({
    summary: 'Lifecycle reference data',
    description: 'The permit state machine as implemented by the backend — used by the app to render the correct actions and explanations.',
  })
  lifecycle() {
    return {
      transitions: PERMIT_TRANSITIONS.map((transition) => ({
        action: transition.action,
        label: transition.label,
        description: transition.description,
        from: transition.from,
        to: transition.to,
        requiresReason: transition.requiresReason ?? false,
        applicantOnly: transition.applicantOnly ?? false,
      })),
    };
  }

  @Post()
  @RequirePermissions('permits:create')
  @ApiOperation({
    summary: 'File a permit application',
    description:
      'Creates the application in DRAFT. Company accounts use their own company; officers must pass companyId. Fees are pre-computed from the volume and the configured royalty rate.',
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePermitDto) {
    return this.permits.create(user, dto);
  }

  @Get(':id')
  @RequireAnyPermission('permits:read', 'permits:read_own')
  @ApiOperation({ summary: 'Permit detail with documents, timeline, payments and available actions' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.permits.findOne(user, id);
  }

  @Patch(':id')
  @RequirePermissions('permits:update')
  @ApiOperation({ summary: 'Update a draft or returned application' })
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdatePermitDto) {
    return this.permits.update(user, id, dto);
  }

  @Get(':id/actions')
  @RequireAnyPermission('permits:read', 'permits:read_own')
  @ApiOperation({
    summary: 'Actions the signed-in user may perform on this permit',
    description: 'The mobile app renders exactly these actions; the backend re-checks the per-action permission when they are invoked.',
  })
  actions(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.permits.listActions(user, id);
  }

  @Get(':id/timeline')
  @RequireAnyPermission('permits:read', 'permits:read_own')
  @ApiOperation({ summary: 'Status history of the permit' })
  timeline(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.permits.timeline(user, id);
  }

  @Post(':id/actions/:action')
  @RequireAnyPermission('permits:read', 'permits:read_own')
  @ApiParam({ name: 'action', enum: PERMIT_ACTIONS, description: 'Lifecycle action to perform' })
  @ApiOperation({
    summary: 'Perform a lifecycle action (submit, review, approve, reject, suspend, revoke, activate…)',
    description:
      'Every transition is validated against the backend state machine before anything is written; illegal transitions return PERMIT_INVALID_TRANSITION. The permission required for each action is enforced server-side, never by the app.',
  })
  transition(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() dto: PermitDecisionDto,
  ) {
    return this.permits.transition(user, id, action.toUpperCase() as PermitAction, dto);
  }

  @Post(':id/renew')
  @RequirePermissions('permits:renew')
  @ApiOperation({
    summary: 'Open a renewal application',
    description: 'Creates a new DRAFT application linked to this permit (previousPermitId) with an optional new volume and period.',
  })
  renew(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: RenewPermitDto) {
    return this.permits.transition(user, id, 'RENEW', {
      reason: dto.notes,
      volumeApprovedM3: dto.volumeRequestedM3,
      endDate: dto.endDate,
    });
  }

  // -------------------------------------------------------------- documents

  @Get(':id/documents')
  @RequireAnyPermission('permits:read', 'permits:read_own')
  @ApiOperation({ summary: 'List the documents attached to a permit' })
  async documents(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: PermitDocumentQueryDto,
  ) {
    const { items, total } = await this.permits.listDocuments(user, id, query);
    return paginate(items, total, query.page, query.limit);
  }

  @Post(':id/documents')
  @RequirePermissions('permits:manage_documents')
  @ApiOperation({
    summary: 'Attach an uploaded document to a permit',
    description: 'Upload the file with POST /files/upload?folder=permits/documents first, then attach the returned fileKey here.',
  })
  addDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreatePermitDocumentDto,
  ) {
    return this.permits.addDocument(user, id, dto);
  }

  @Patch(':id/documents/:documentId/verify')
  @RequirePermissions('permits:review')
  @ApiOperation({ summary: 'Verify or un-verify a permit document' })
  verifyDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Body() dto: VerifyPermitDocumentDto,
  ) {
    return this.permits.verifyDocument(user, id, documentId, dto);
  }

  @Delete(':id/documents/:documentId')
  @RequirePermissions('permits:manage_documents')
  @ApiOperation({ summary: 'Remove a permit document' })
  removeDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
  ) {
    return this.permits.removeDocument(user, id, documentId);
  }
}
