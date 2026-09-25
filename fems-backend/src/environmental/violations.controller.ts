import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ViolationsService } from './violations.service';
import { VIOLATION_ACTIONS } from './violation-state';
import { CreateViolationDto, UpdateViolationDto, ViolationActionDto, ViolationQueryDto } from './dto/violation.dto';
import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '../common/decorators';
import { paginate } from '../common/dto/pagination.dto';

@ApiTags('environmental')
@ApiBearerAuth('bearer')
@Controller('violations')
export class ViolationsController {
  constructor(private readonly violations: ViolationsService) {}

  @Get()
  @RequirePermissions('environmental:read')
  @ApiOperation({
    summary: 'List environmental violations',
    description:
      'A company account only sees cases opened against it; regulators see every case in their scope. The response also carries the penalty position.',
  })
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ViolationQueryDto) {
    const { items, total, penalties } = await this.violations.list(user, query);
    return { ...paginate(items, total, query.page, query.limit), penalties };
  }

  @Get('statistics')
  @RequirePermissions('environmental:read')
  @ApiOperation({ summary: 'Case counts, assessed damage, penalties and overdue remediation' })
  statistics(@CurrentUser() user: AuthenticatedUser, @Query() query: ViolationQueryDto) {
    return this.violations.statistics(user, query);
  }

  @Post()
  @RequirePermissions('environmental:create')
  @ApiOperation({
    summary: 'Open a violation from documented field evidence',
    description:
      'The case must reference the inspection or the observation that recorded the facts, and carries the device GPS position. ' +
      'Linking an AI alert is possible, but the decision to open a case is always human.',
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateViolationDto) {
    return this.violations.create(user, dto);
  }

  @Get(':id')
  @RequirePermissions('environmental:read')
  @ApiOperation({ summary: 'Case detail with penalty position, linked alerts, evidence and available actions' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.violations.findOne(user, id);
  }

  @Get(':id/penalty')
  @RequirePermissions('environmental:read')
  @ApiOperation({ summary: 'Penalty position of a case (fined, actually settled by the provider, outstanding)' })
  penalty(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.violations.penaltyPosition(id);
  }

  @Patch(':id')
  @RequirePermissions('environmental:update')
  @ApiOperation({ summary: 'Update the case file (severity, assessed damage, remediation terms, notes)' })
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateViolationDto) {
    return this.violations.update(user, id, dto);
  }

  @Post(':id/actions/:action')
  @RequirePermissions('environmental:read')
  @ApiParam({ name: 'action', enum: VIOLATION_ACTIONS })
  @ApiOperation({
    summary: 'Progress a case: INVESTIGATE, CONFIRM, DISMISS, ESCALATE, RESOLVE or REOPEN',
    description:
      'The lifecycle is validated server-side and the caller must hold the permission the action requires: ' +
      'CONFIRM/DISMISS/ESCALATE/REOPEN need `environmental:manage_violations`, RESOLVE needs `environmental:resolve_violation`. ' +
      'A case with an unpaid penalty cannot be resolved unless the penalty is explicitly waived with a written justification.',
  })
  action(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() dto: ViolationActionDto,
  ) {
    return this.violations.action(user, id, action, dto);
  }

  @Delete(':id')
  @RequirePermissions('environmental:manage_violations')
  @ApiOperation({ summary: 'Withdraw an OPEN case that was recorded in error' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.violations.remove(user, id);
  }
}
