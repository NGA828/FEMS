/**
 * Shared Prisma tooling helpers.
 *
 * FEMS is built to run in environments where the Prisma engine binaries
 * (`binaries.prisma.sh`) may be unreachable — for example air-gapped government
 * networks or the restricted CI sandbox this project was built in. Every script
 * in `scripts/` therefore uses Prisma's official *WASM* engines (which ship
 * inside the npm packages) instead of the downloadable native binaries:
 *
 *   - schema validation / DMMF  -> @prisma/prisma-schema-wasm (via @prisma/internals)
 *   - client code generation   -> @prisma/client-generator-js + @prisma/internals DMMF
 *   - migration SQL            -> generated from the DMMF (scripts/generate-migration-sql.mjs)
 *   - drift detection          -> DMMF compared with MySQL information_schema
 *
 * When the network *is* available the standard Prisma CLI commands
 * (`npx prisma generate`, `npx prisma migrate dev`, `npx prisma studio`) work too
 * and produce byte-compatible results — see docs/setup.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

export const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const schemaPath = path.join(backendRoot, 'prisma', 'schema.prisma');
export const migrationsDir = path.join(backendRoot, 'prisma', 'migrations');

/** Load the Prisma datamodel (DMMF) using the WASM schema formatter — no network. */
export async function loadDmmf(datamodelPath = schemaPath) {
  // @prisma/internals ships CommonJS; require() keeps named exports available.
  const { getDMMF } = require('@prisma/internals');
  const datamodel = fs.readFileSync(datamodelPath, 'utf8');
  const dmmf = await getDMMF({ datamodel });
  return { datamodel, dmmf };
}

/** Parse `@db.<NativeType>` modifiers keyed by `Model.field` (DMMF omits native types). */
export function parseNativeTypes(datamodel) {
  const native = new Map();
  const modelRe = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let modelMatch;
  while ((modelMatch = modelRe.exec(datamodel)) !== null) {
    const [, modelName, body] = modelMatch;
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue;
      const fieldMatch = line.match(/^(\w+)\s+[\w[\]?]+\s*(.*)$/);
      if (!fieldMatch) continue;
      const [, fieldName, rest] = fieldMatch;
      const dbType = rest.match(/@db\.(\w+)\s*(?:\(([^)]*)\))?/);
      if (dbType) {
        const args = (dbType[2] || '')
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean)
          .map(Number);
        native.set(`${modelName}.${fieldName}`, { type: dbType[1], args });
      }
    }
  }
  return native;
}

/** Parse `@@map("table_name")` names keyed by model name. */
export function parseTableNames(datamodel, models) {
  const names = new Map();
  for (const model of models) {
    const re = new RegExp(`model\\s+${model.name}\\s*\\{([\\s\\S]*?)\\n\\}`);
    const match = re.exec(datamodel);
    const mapMatch = match && match[1].match(/@@map\("([^"]+)"\)/);
    names.set(model.name, mapMatch ? mapMatch[1] : model.name);
  }
  return names;
}

/** Resolve the database URL exactly like the NestJS config layer does. */
export function resolveDatabaseUrl(env = process.env) {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  loadDotEnv(path.join(backendRoot, '.env'));
  return process.env.DATABASE_URL;
}

/** Minimal .env loader (no dependency, used by build-time scripts). */
export function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  const contents = fs.readFileSync(envPath, 'utf8');
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/** Parse a mysql:// URL into mariadb driver connection options. */
export function parseMysqlUrl(url) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
    multipleStatements: true,
    decimalAsNumber: false,
    bigIntAsNumber: false,
    allowPublicKeyRetrieval: true,
  };
}

/** Open a mariadb connection using DATABASE_URL. */
export async function connectDatabase(url = resolveDatabaseUrl()) {
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy fems-backend/.env.example to fems-backend/.env and configure it.',
    );
  }
  const mariadb = await import('mariadb');
  return mariadb.default.createConnection(parseMysqlUrl(url));
}

export function log(step, message) {
  // eslint-disable-next-line no-console
  console.log(`[${step}] ${message}`);
}

/**
 * Normalised description of every model in the schema, used by the drift check:
 * table name, column names, nullability, native types, unique indexes and the
 * foreign keys Prisma would create (`<table>_<columns>_fkey`).
 */
export async function loadSchemaIndexes() {
  const { datamodel, dmmf } = await loadDmmf();
  const models = dmmf.datamodel.models;
  const tableNames = parseTableNames(datamodel, models);
  const nativeTypes = parseNativeTypes(datamodel);

  const byModel = {};
  for (const model of models) {
    const tableName = tableNames.get(model.name) ?? model.name;

    // column names may be remapped per field with @map("column")
    const modelBody = new RegExp(`model\\s+${model.name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(datamodel);
    const body = modelBody ? modelBody[1] : '';
    const columnName = (fieldName) => {
      const line = body
        .split('\n')
        .map((entry) => entry.trim())
        .find((entry) => entry.startsWith(`${fieldName} `));
      const mapped = line && line.match(/@map\("([^"]+)"\)/);
      return mapped ? mapped[1] : fieldName;
    };

    const fields = {};
    for (const field of model.fields) {
      if (field.kind === 'object') continue;
      if (field.relationFromFields && field.relationFromFields.length > 0 && field.kind === 'scalar') {
        // scalars backing a relation still live in the table
      }
      fields[field.name] = {
        dbName: columnName(field.name),
        kind: field.kind,
        type: field.type,
        isRequired: field.isRequired,
        isList: field.isList,
        isUnique: field.isUnique,
        isId: field.isId,
        nativeType: nativeTypes.get(`${model.name}.${field.name}`)?.type ?? field.nativeType?.[0] ?? null,
      };
    }

    const uniqueIndexes = [];
    for (const [fieldName, field] of Object.entries(fields)) {
      if (field.isUnique) uniqueIndexes.push({ name: `${tableName}_${field.dbName}_key`, columns: [field.dbName] });
    }
    for (const match of body.matchAll(/@@unique\(\[([^\]]+)\](?:\s*,\s*(?:map:\s*)?"([^"]*)")?\)/g)) {
      const columns = match[1].split(',').map((entry) => columnName(entry.trim()));
      uniqueIndexes.push({ name: match[2] || `${tableName}_${columns.join('_')}_key`, columns });
    }

    const relations = [];
    for (const field of model.fields) {
      if (field.kind !== 'object' || !field.relationFromFields || field.relationFromFields.length === 0) continue;
      const target = models.find((entry) => entry.name === field.type);
      const targetTable = target ? tableNames.get(target.name) ?? target.name : null;
      relations.push({
        field: field.name,
        constraintName: `${tableName}_${field.relationFromFields.join('_')}_fkey`,
        columns: field.relationFromFields.map((name) => columnName(name)),
        referencedTable: targetTable,
        referencedColumns: (field.relationToFields ?? []).map((name) => columnName(name)),
      });
    }

    byModel[model.name] = { tableName, fields, uniqueIndexes, relations };
  }

  return { datamodel, dmmf, models: byModel };
}
