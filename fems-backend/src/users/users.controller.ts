import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import {
  AdminResetPasswordDto,
  AssignRoleDto,
  CreateUserDto,
  UpdateUserDto,
  UpdateUserStatusDto,
  UsersQueryDto,
} from './dto/users.dto';
import { Audit, CurrentUser, RequirePermissions, type AuthenticatedUser } from '../common/decorators';
import { paginate } from '../common/dto/pagination.dto';

@ApiTags('users')
@ApiBearerAuth('bearer')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users:read')
  @ApiOperation({
    summary: 'List accounts (searchable, filterable by role, status and company)',
    description: 'Requires `users:read` — administrators and government officers.',
  })
  async list(@Query() query: UsersQueryDto) {
    const { items, total } = await this.users.list(query);
    return paginate(items, total, query.page, query.limit);
  }

  @Get('statistics')
  @RequirePermissions('users:read')
  @ApiOperation({ summary: 'Account counters per status and role' })
  statistics() {
    return this.users.statistics();
  }

  @Post()
  @RequirePermissions('users:create')
  @Audit({ action: 'CREATE', entityType: 'User' })
  @ApiOperation({
    summary: 'Create an account with any role',
    description:
      'Administrators provision regulator, inspector, operator and administrator accounts. When no password is supplied the API generates a strong temporary password and returns it exactly once.',
  })
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.users.create(dto, actor);
  }

  @Get(':id')
  @RequirePermissions('users:read')
  @ApiOperation({ summary: 'Account detail with active sessions and recent activity' })
  detail(@Param('id') id: string) {
    return this.users.detail(id);
  }

  @Patch(':id')
  @RequirePermissions('users:update')
  @ApiOperation({ summary: 'Update an account' })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.users.update(id, dto, actor);
  }

  @Patch(':id/status')
  @RequirePermissions('users:deactivate')
  @ApiOperation({
    summary: 'Activate, suspend or deactivate an account',
    description:
      'Suspension and deactivation immediately revoke every active session; the JWT is never trusted after the change.',
  })
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.updateStatus(id, dto, actor);
  }

  @Post(':id/roles')
  @RequirePermissions('users:manage_roles')
  @ApiOperation({
    summary: 'Grant a role (optionally with an expiry for temporary assignments)',
    description: 'Requires `users:manage_roles`. Granting ADMINISTRATOR requires the wildcard permission.',
  })
  assignRole(@Param('id') id: string, @Body() dto: AssignRoleDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.users.assignRole(id, dto, actor);
  }

  @Delete(':id/roles/:roleName')
  @RequirePermissions('users:manage_roles')
  @ApiOperation({ summary: 'Revoke a role (the last remaining role cannot be removed)' })
  revokeRole(
    @Param('id') id: string,
    @Param('roleName') roleName: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.revokeRole(id, roleName, actor);
  }

  @Post(':id/reset-password')
  @RequirePermissions('users:reset_password')
  @ApiOperation({
    summary: 'Administrator password reset',
    description: 'Generates a temporary password (returned once) and revokes the user’s sessions.',
  })
  resetPassword(
    @Param('id') id: string,
    @Body() dto: AdminResetPasswordDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.resetPassword(id, dto, actor);
  }

  @Delete(':id')
  @RequirePermissions('users:deactivate')
  @ApiOperation({ summary: 'Deactivate (soft-delete) an account and revoke its sessions' })
  remove(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.users.softDelete(id, actor);
  }

  @Post(':id/restore')
  @RequirePermissions('users:update')
  @ApiOperation({ summary: 'Restore a deactivated account' })
  restore(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.users.restore(id, actor);
  }
}
