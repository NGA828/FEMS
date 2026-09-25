import {
  PERMISSIONS,
  PERMISSION_CATALOGUE,
  PERMISSION_CODES,
  ROLE_NAMES,
  ROLES,
  WILDCARD,
} from '../common/constants/permissions';

/**
 * The catalogue is the single source of truth for authorization: the guards
 * read the codes from here, and `RbacService` mirrors the same list into the
 * database. A role that references a code which does not exist in the
 * catalogue is silently dropped during synchronisation — exactly the class of
 * bug that would lock administrators out without any error. These tests make
 * that impossible to ship.
 */
describe('RBAC catalogue', () => {
  it('declares every permission exactly once', () => {
    const codes = PERMISSION_CODES;
    expect(new Set(codes).size).toBe(codes.length);
    expect(PERMISSIONS.length).toBeGreaterThan(100);
  });

  it('creates a database row for every permission, including the wildcard', () => {
    const catalogueCodes = PERMISSION_CATALOGUE.map((permission) => permission.code);
    expect(catalogueCodes).toContain(WILDCARD);
    expect(new Set(catalogueCodes).size).toBe(catalogueCodes.length);
    for (const code of PERMISSION_CODES) {
      expect(catalogueCodes).toContain(code);
    }
  });

  it('resolves every role grant against the synchronised catalogue', () => {
    const catalogueCodes = new Set(PERMISSION_CATALOGUE.map((permission) => permission.code));
    const unresolvable: string[] = [];
    for (const role of ROLES) {
      for (const code of role.permissions) {
        if (!catalogueCodes.has(code)) unresolvable.push(`${role.name} → ${code}`);
      }
    }
    expect(unresolvable).toEqual([]);
  });

  it('grants the wildcard to administrators only', () => {
    const withWildcard = ROLES.filter((role) => role.permissions.includes(WILDCARD)).map((role) => role.name);
    expect(withWildcard).toEqual(['ADMINISTRATOR']);
  });

  it('keeps `<module>:<action>` shape for every concrete permission', () => {
    for (const permission of PERMISSIONS) {
      expect(permission.code).toMatch(/^[a-z][a-z-]*:[a-z_]+$/);
      expect(permission.code.split(':')[0]).toBe(permission.module);
      expect(permission.description.trim().length).toBeGreaterThan(0);
    }
  });

  it('defines the eight system roles with unique names and stable ordering', () => {
    expect(ROLES.map((role) => role.name)).toEqual([...ROLE_NAMES]);
    expect(new Set(ROLES.map((role) => role.name)).size).toBe(ROLES.length);
    const expectedLevels: Record<string, number> = {
      VISITOR: 0,
      FOREST_EXPLORER: 10,
      COMPANY_REPRESENTATIVE: 20,
      FIELD_OPERATOR: 25,
      FOREST_INSPECTOR: 30,
      GOVERNMENT_FOREST_OFFICER: 40,
      ENVIRONMENTAL_OFFICER: 40,
      ADMINISTRATOR: 100,
    };
    for (const role of ROLES) {
      expect(role.level).toBe(expectedLevels[role.name]);
      expect(role.label.length).toBeGreaterThan(2);
      expect(role.description.length).toBeGreaterThan(20);
    }
  });

  it('exposes each granted permission exactly once (duplicates are removed at export)', () => {
    for (const role of ROLES) {
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
      expect(role.permissions.length).toBeGreaterThan(0);
    }
  });
});
