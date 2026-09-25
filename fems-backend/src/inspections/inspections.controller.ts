import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { InspectionsService } from './inspections.service';
import { ObservationsService } from './observations.service';
import {
  CancelInspectionDto,
  CreateInspectionDto,
  InspectionQueryDto,
  ReviewInspectionDto,
  StartInspectionDto,
  SubmitInspectionDto,
  UpdateInspectionDto,
} from './dto/inspection.dto';
import {
  AttachEvidenceDto,
  CreateObservationDto,
  ObservationQueryDto,
  ObservationSyncDto,
  UpdateObservationDto,
} from './dto/observation.dto';
import { CurrentUser, RequireAnyPermission, RequirePermissions, type AuthenticatedUser } from '../common/decorators';
import { paginate } from '../common/dto/pagination.dto';

@ApiTags('inspections')
@ApiBearerAuth('bearer')
@Controller('inspections')
export class InspectionsController {
  constructor(private readonly inspections: InspectionsService) {}

  @Get()
  @RequireAnyPermission('inspections:read', 'inspections:read_own')
  @ApiOperation({
    summary: 'List inspections',
    description:
      'Regulators see every inspection; a forest inspector sees those assigned to them; a company sees inspections carried out on its own sites.',
  })
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: InspectionQueryDto) {
    const { items, total } = await this.inspections.list(user, query);
    return paginate(items, total, query.page, query.limit);
  }

  @Get('statistics')
  @RequireAnyPermission('inspections:read', 'inspections:read_own')
  @ApiOperation({ summary: 'Inspection coverage, outcomes and open violations' })
  statistics(@CurrentUser() user: AuthenticatedUser, @Query() query: InspectionQueryDto) {
    return this.inspections.statistics(user, query);
  }

  @Get('evidence')
  @RequireAnyPermission('inspections:read', 'inspections:read_own')
  @ApiOperation({ summary: 'List evidence attached to an inspection, observation or activity' })
  evidence(
    @CurrentUser() user: AuthenticatedUser,
    @Query('inspectionId') inspectionId?: string,
    @Query('observationId') observationId?: string,
    @Query('activityId') activityId?: string,
  ) {
    return this.inspections.listEvidence(user, { inspectionId, observationId, activityId });
  }

  @Post()
  @RequirePermissions('inspections:create')
  @ApiOperation({
    summary: 'Schedule an inspection',
    description: 'Creates the inspection with the checklist template of its type and notifies the assigned officer.',
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateInspectionDto) {
    return this.inspections.create(user, dto);
  }

  @Post('evidence')
  @RequirePermissions('inspections:submit')
  @ApiOperation({
    summary: 'Attach an uploaded file as evidence',
    description: 'The file must already exist in storage (POST /files/upload); the server checks it and derives the download URL.',
  })
  attachEvidence(@CurrentUser() user: AuthenticatedUser, @Body() dto: AttachEvidenceDto) {
    return this.inspections.attachEvidence(user, dto);
  }

  @Get(':id')
  @RequireAnyPermission('inspections:read', 'inspections:read_own')
  @ApiOperation({ summary: 'Inspection detail with checklist, evidence, observations and violations' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.inspections.findOne(user, id);
  }

  @Patch(':id')
  @RequirePermissions('inspections:update')
  @ApiOperation({ summary: 'Update a scheduled inspection (title, checklist, assignment, schedule)' })
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateInspectionDto) {
    return this.inspections.update(user, id, dto);
  }

  @Post(':id/start')
  @RequirePermissions('inspections:submit')
  @ApiOperation({
    summary: 'Start the field inspection',
    description:
      'Records the device GPS position, validates its accuracy and measures the distance to the inspected activity. A report filed far from the site is refused.',
  })
  start(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: StartInspectionDto) {
    return this.inspections.start(user, id, dto);
  }

  @Post(':id/submit')
  @RequirePermissions('inspections:submit')
  @ApiOperation({
    summary: 'Submit the inspection report',
    description:
      'Every checklist item must be answered; the compliance score is computed server-side and the outcome must be consistent with the failed items. Carries a clientRef so an offline retry is not duplicated.',
  })
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: SubmitInspectionDto) {
    return this.inspections.submit(user, id, dto);
  }

  @Post(':id/review')
  @RequirePermissions('inspections:review')
  @ApiOperation({ summary: 'Review a submitted inspection' })
  review(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReviewInspectionDto) {
    return this.inspections.review(user, id, dto);
  }

  @Post(':id/close')
  @RequirePermissions('inspections:close')
  @ApiOperation({
    summary: 'Close a reviewed inspection',
    description: 'Refused while violations opened during the inspection are still unresolved.',
  })
  close(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ReviewInspectionDto) {
    return this.inspections.close(user, id, dto.notes);
  }

  @Post(':id/cancel')
  @RequirePermissions('inspections:update')
  @ApiOperation({ summary: 'Cancel a scheduled or in-progress inspection (reason required)' })
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CancelInspectionDto) {
    return this.inspections.cancel(user, id, dto);
  }
}

@ApiTags('observations')
@ApiBearerAuth('bearer')
@Controller('observations')
export class ObservationsController {
  constructor(private readonly observations: ObservationsService) {}

  @Get()
  @RequirePermissions('observations:read')
  @ApiOperation({ summary: 'List field observations' })
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ObservationQueryDto) {
    const { items, total } = await this.observations.list(user, query);
    return paginate(items, total, query.page, query.limit);
  }

  @Get('statistics')
  @RequirePermissions('observations:read')
  @ApiOperation({ summary: 'Observation counts by category and severity' })
  statistics(@CurrentUser() user: AuthenticatedUser, @Query() query: ObservationQueryDto) {
    return this.observations.statistics(user, query);
  }

  @Post()
  @RequirePermissions('observations:create')
  @ApiOperation({
    summary: 'Record an observation on site',
    description:
      'Requires the device GPS position (validated server-side). HIGH and CRITICAL observations notify the environmental officers — they never open a violation automatically.',
  })
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateObservationDto) {
    const { observation, duplicate, gpsWarning } = await this.observations.create(user, dto);
    return { ...observation, duplicate, gpsWarning };
  }

  @Post('offline-sync')
  @RequirePermissions('observations:create')
  @ApiOperation({ summary: 'Synchronise observations captured offline (clientRef de-duplicates replays)' })
  sync(@CurrentUser() user: AuthenticatedUser, @Body() dto: ObservationSyncDto) {
    return this.observations.syncOfflineBatch(user, dto);
  }

  @Get(':id')
  @RequirePermissions('observations:read')
  @ApiOperation({ summary: 'Observation detail' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.observations.findOne(user, id);
  }

  @Patch(':id')
  @RequirePermissions('observations:update')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Update an observation' })
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateObservationDto) {
    return this.observations.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('observations:delete')
  @ApiOperation({ summary: 'Delete an observation (author or regulator only)' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.observations.remove(user, id);
  }
}
