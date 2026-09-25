import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RbacService } from '../rbac/rbac.service';
import { Public, RequirePermissions } from '../common/decorators';

@ApiTags('roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly rbac: RbacService) {}

  @Public()
  @Get('catalogue')
  @ApiOperation({
    summary: 'Role catalogue with permission counts (public: used by the registration screen)',
    description: 'Self-registration only allows FOREST_EXPLORER and COMPANY_REPRESENTATIVE; other roles are provisioned by an administrator.',
  })
  catalogue() {
    return this.rbac.rolesInCatalogue;
  }

  @Get()
  @ApiBearerAuth('bearer')
  @RequirePermissions('roles:read')
  @ApiOperation({ summary: 'Roles with their effective permissions and member counts' })
  list() {
    return this.rbac.listRoles();
  }

  @Get('permissions')
  @ApiBearerAuth('bearer')
  @RequirePermissions('roles:read')
  @ApiOperation({ summary: 'Every permission code grouped by module' })
  permissions() {
    return this.rbac.listPermissions();
  }

  @Get('catalogue/sync-status')
  @ApiBearerAuth('bearer')
  @RequirePermissions('roles:manage')
  @ApiOperation({ summary: 'Verify that the stored catalogue matches the code definition' })
  syncStatus() {
    return this.rbac.isCatalogueInSync();
  }

  @Get(':name')
  @ApiBearerAuth('bearer')
  @RequirePermissions('roles:read')
  @ApiOperation({ summary: 'A single role with its permissions' })
  findOne(@Param('name') name: string) {
    return this.rbac.findRoleByName(name);
  }
}
