import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { appConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSION_CATALOGUE, ROLES, WILDCARD } from '../common/constants/permissions';

export interface RoleWithPermissions {
  id: string;
  name: string;
  label: string;
  description: string | null;
  level: number;
  isSystem: boolean;
  permissions: Array<{ code: string; module: string; description: string }>;
  userCount: number;
}

export interface SyncResult {
  permissionsCreated: number;
  permissionsUpdated: number;
  rolesCreated: number;
  rolesUpdated: number;
  rolePermissionsAdded: number;
  rolePermissionsRemoved: number;
}

/**
 * System RBAC.
 *
 * Roles and permissions are defined in code (`common/constants/permissions.ts`)
 * and synchronised into the database — the database can never drift from the
 * catalogue used by the guards. The sync is idempotent, so booting the API is
 * always safe; it runs automatically unless RBAC_SYNC_ON_BOOT=false.
 */
@Injectable()
export class RbacService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RbacService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.syncEnabled) return;
    try {
      const result = await this.syncCatalogue();
      this.logger.log(
        `RBAC catalogue synchronised — ${result.rolesCreated} role(s) and ${result.permissionsCreated} permission(s) created, ` +
          `${result.rolePermissionsAdded} grant(s) added, ${result.rolePermissionsRemoved} stale grant(s) removed.`,
      );
    } catch (error) {
      this.logger.error(`RBAC synchronisation failed: ${(error as Error).message}`);
      throw error;
    }
  }

  private get syncEnabled(): boolean {
    return (process.env.RBAC_SYNC_ON_BOOT ?? 'true').toLowerCase() !== 'false';
  }

  /** Upserts every permission and role from the catalogue and reconciles grants. */
  async syncCatalogue(): Promise<SyncResult> {
    const result: SyncResult = {
      permissionsCreated: 0,
      permissionsUpdated: 0,
      rolesCreated: 0,
      rolesUpdated: 0,
      rolePermissionsAdded: 0,
      rolePermissionsRemoved: 0,
    };

    const permissionIdByCode = new Map<string, string>();
    for (const permission of PERMISSION_CATALOGUE) {
      const existing = await this.prisma.permission.findUnique({ where: { code: permission.code } });
      if (!existing) {
        const created = await this.prisma.permission.create({
          data: {
            code: permission.code,
            module: permission.module,
            description: permission.description,
          },
        });
        permissionIdByCode.set(permission.code, created.id);
        result.permissionsCreated += 1;
      } else {
        permissionIdByCode.set(permission.code, existing.id);
        if (existing.module !== permission.module || existing.description !== permission.description) {
          await this.prisma.permission.update({
            where: { id: existing.id },
            data: { module: permission.module, description: permission.description },
          });
          result.permissionsUpdated += 1;
        }
      }
    }

    for (const role of ROLES) {
      const existingRole = await this.prisma.role.findUnique({ where: { name: role.name } });
      const roleRecord = existingRole
        ? await this.prisma.role.update({
            where: { id: existingRole.id },
            data: { label: role.label, description: role.description, level: role.level },
          })
        : await this.prisma.role.create({
            data: {
              name: role.name,
              label: role.label,
              description: role.description,
              level: role.level,
              isSystem: true,
            },
          });
      if (existingRole) result.rolesUpdated += 1;
      else result.rolesCreated += 1;

      const desiredIds = new Set(
        role.permissions
          .map((code) => permissionIdByCode.get(code))
          .filter((id): id is string => Boolean(id)),
      );

      const current = await this.prisma.rolePermission.findMany({ where: { roleId: roleRecord.id } });
      const currentIds = new Set(current.map((grant) => grant.permissionId));

      const toAdd = [...desiredIds].filter((id) => !currentIds.has(id));
      const toRemove = [...currentIds].filter((id) => !desiredIds.has(id));

      if (toAdd.length > 0) {
        await this.prisma.rolePermission.createMany({
          data: toAdd.map((permissionId) => ({ roleId: roleRecord.id, permissionId })),
          skipDuplicates: true,
        });
        result.rolePermissionsAdded += toAdd.length;
      }
      if (toRemove.length > 0) {
        await this.prisma.rolePermission.deleteMany({
          where: { roleId: roleRecord.id, permissionId: { in: toRemove } },
        });
        result.rolePermissionsRemoved += toRemove.length;
      }
    }

    return result;
  }

  async listRoles(): Promise<RoleWithPermissions[]> {
    const roles = await this.prisma.role.findMany({
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
      orderBy: { level: 'desc' },
    });
    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      label: role.label,
      description: role.description,
      level: role.level,
      isSystem: role.isSystem,
      permissions: role.permissions
        .map((grant) => ({
          code: grant.permission.code,
          module: grant.permission.module,
          description: grant.permission.description,
        }))
        .sort((a, b) => a.code.localeCompare(b.code)),
      userCount: role._count.users,
    }));
  }

  async findRoleByName(name: string) {
    const role = await this.prisma.role.findUnique({
      where: { name },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) {
      throw new NotFoundException({ code: 'ROLE_NOT_FOUND', message: `Role ${name} does not exist.` });
    }
    return role;
  }

  async listPermissions() {
    const permissions = await this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { code: 'asc' }] });
    const byModule = new Map<string, Array<{ code: string; description: string }>>();
    let wildcard: { code: string; description: string } | null = null;
    for (const permission of permissions) {
      if (permission.code === WILDCARD) {
        wildcard = { code: permission.code, description: permission.description };
        continue;
      }
      const bucket = byModule.get(permission.module) ?? [];
      bucket.push({ code: permission.code, description: permission.description });
      byModule.set(permission.module, bucket);
    }
    const wildcardRoles = wildcard
      ? (
          await this.prisma.rolePermission.findMany({
            where: { permission: { code: WILDCARD } },
            include: { role: { select: { name: true } } },
          })
        ).map((grant) => grant.role.name)
      : [];
    return {
      total: permissions.length - (wildcard ? 1 : 0),
      wildcard: wildcard ? { ...wildcard, grantedTo: wildcardRoles } : null,
      modules: [...byModule.entries()].map(([module, items]) => ({ module, permissions: items })),
    };
  }

  /** True when the catalogue matches what is stored (used by /health). */
  async isCatalogueInSync(): Promise<{ inSync: boolean; expectedRoles: number; storedRoles: number }> {
    const storedRoles = await this.prisma.role.count({ where: { isSystem: true } });
    return { inSync: storedRoles === ROLES.length, expectedRoles: ROLES.length, storedRoles };
  }

  get rolesInCatalogue() {
    return ROLES.map((role) => ({
      name: role.name,
      label: role.label,
      description: role.description,
      level: role.level,
      permissionCount: role.permissions.length,
    }));
  }

  get environmentLabel(): string {
    return appConfig().env;
  }
}
