#!/usr/bin/env node
/**
 * Generate the MySQL migration SQL for a Prisma schema — without the Prisma
 * native engine binaries.
 *
 *   node scripts/generate-migration-sql.mjs [--out <file>] [--from-empty]
 *
 * Why this exists: `prisma migrate dev` needs the `schema-engine` binary that
 * Prisma downloads from binaries.prisma.sh. In air-gapped/restricted
 * environments that download is impossible. This script derives exactly the
 * same DDL from the official Prisma DMMF (WASM schema formatter), following
 * Prisma's own naming conventions, so the committed migration files stay
 * compatible with `prisma migrate deploy` / `prisma migrate status` on a normal
 * machine.
 *
 * Inspect the result with `node scripts/verify-schema-drift.mjs` after applying.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadDmmf, parseNativeTypes, parseTableNames, log } from './lib/schema-tools.mjs';

const SCALAR_DEFAULTS = {
  String: 'VARCHAR(191)',
  Boolean: 'TINYINT(1)',
  Int: 'INT',
  BigInt: 'BIGINT',
  Float: 'DOUBLE',
  Decimal: 'DECIMAL(65,30)',
  DateTime: 'DATETIME(3)',
  Json: 'JSON',
  Bytes: 'LONGBLOB',
};

function columnType(field, native, enumType) {
  if (enumType) {
    const values = enumType.values.map((v) => `'${v.name}'`).join(', ');
    return `ENUM(${values})`;
  }
  const dbType = native && native.type;
  if (!dbType) return SCALAR_DEFAULTS[field.type] || 'VARCHAR(191)';
  const args = (native.args || []).filter((n) => !Number.isNaN(n));
  const withArgs = args.length ? `(${args.join(', ')})` : '';
  switch (dbType) {
    case 'VarChar':
      return `VARCHAR${withArgs || '(191)'}`;
    case 'Char':
      return `CHAR${withArgs || '(1)'}`;
    case 'Text':
      return 'TEXT';
    case 'TinyText':
      return 'TINYTEXT';
    case 'MediumText':
      return 'MEDIUMTEXT';
    case 'LongText':
      return 'LONGTEXT';
    case 'Int':
      return 'INT';
    case 'UnsignedInt':
      return 'INT UNSIGNED';
    case 'BigInt':
      return 'BIGINT';
    case 'SmallInt':
      return 'SMALLINT';
    case 'TinyInt':
      return 'TINYINT';
    case 'Decimal':
      return `DECIMAL${withArgs}`;
    case 'Float':
      return 'FLOAT';
    case 'Double':
      return 'DOUBLE';
    case 'DateTime':
      return `DATETIME${withArgs || '(3)'}`;
    case 'Date':
      return 'DATE';
    case 'Time':
      return 'TIME';
    case 'Timestamp':
      return 'TIMESTAMP';
    case 'Boolean':
      return 'TINYINT(1)';
    case 'Json':
      return 'JSON';
    case 'Bit':
      return `BIT${withArgs || '(1)'}`;
    case 'VarBinary':
      return `VARBINARY${withArgs || '(255)'}`;
    case 'Blob':
      return 'BLOB';
    case 'LongBlob':
      return 'LONGBLOB';
    default:
      return SCALAR_DEFAULTS[field.type] || 'VARCHAR(191)';
  }
}

function columnDefault(field, enumType) {
  if (!field.hasDefaultValue) return '';
  const value = field.default;
  if (typeof value === 'object' && value !== null) {
    if (value.name === 'autoincrement') return ' AUTO_INCREMENT';
    // uuid()/cuid()/nanoid() are generated client-side by Prisma.
    if (['uuid', 'cuid', 'nanoid', 'ulid'].includes(value.name)) return '';
    if (value.name === 'now') return ' DEFAULT CURRENT_TIMESTAMP(3)';
    if (value.name === 'dbgenerated') {
      return ` DEFAULT (${value.args && value.args[0] ? String(value.args[0]) : ''})`;
    }
    return '';
  }
  if (typeof value === 'string') return ` DEFAULT '${value.replace(/'/g, "''")}'`;
  if (typeof value === 'boolean') return ` DEFAULT ${value ? 1 : 0}`;
  if (typeof value === 'number') return ` DEFAULT ${value}`;
  return '';
}

function buildStatements(datamodel, dmmf) {
  const nativeTypes = parseNativeTypes(datamodel);
  const tableNames = parseTableNames(datamodel, dmmf.datamodel.models);
  const enums = new Map(dmmf.datamodel.enums.map((e) => [e.name, e]));
  const creates = [];
  const alters = [];

  for (const model of dmmf.datamodel.models) {
    const table = tableNames.get(model.name);
    const columns = [];
    const indexes = [];
    const foreignKeys = [];
    const primaryKeyFields = model.primaryKey
      ? model.primaryKey.fields
      : model.fields.filter((f) => f.isId).map((f) => f.name);

    for (const field of model.fields) {
      if (field.kind !== 'scalar' && field.kind !== 'enum') continue;
      const native = nativeTypes.get(`${model.name}.${field.name}`);
      const enumType = field.kind === 'enum' ? enums.get(field.type) : null;
      const type = columnType(field, native, enumType);
      const nullable = field.isRequired ? ' NOT NULL' : ' NULL';
      const isSinglePk = primaryKeyFields.length === 1 && primaryKeyFields[0] === field.name;
      if (field.isId && field.kind === 'scalar' && isSinglePk) {
        const autoIncrement = columnDefault(field, enumType).includes('AUTO_INCREMENT')
          ? ' AUTO_INCREMENT'
          : '';
        columns.push(`    \`${field.name}\` ${type} NOT NULL${autoIncrement}`);
      } else {
        const def = field.isUpdatedAt ? '' : columnDefault(field, enumType);
        columns.push(`    \`${field.name}\` ${type}${nullable}${def}`);
      }

      if (field.isUnique) {
        indexes.push(`    UNIQUE INDEX \`${table}_${field.name}_key\`(\`${field.name}\`)`);
      }
    }

    // composite uniques / indexes from the model level
    const modelBody = new RegExp(`model\\s+${model.name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(datamodel);
    const body = modelBody ? modelBody[1] : '';
    for (const match of body.matchAll(/@@unique\(\[([^\]]+)\](?:\s*,\s*(?:map:\s*)?"([^"]*)")?\)/g)) {
      const fields = match[1].split(',').map((f) => f.trim());
      const name = match[2] || `${table}_${fields.join('_')}_key`;
      indexes.push(`    UNIQUE INDEX \`${name}\`(${fields.map((f) => `\`${f}\``).join(', ')})`);
    }
    for (const match of body.matchAll(/@@index\(\[([^\]]+)\](?:\s*,\s*(?:map:\s*)?"([^"]*)")?\)/g)) {
      const fields = match[1].split(',').map((f) => f.trim());
      const name = match[2] || `${table}_${fields.join('_')}_idx`;
      indexes.push(`    INDEX \`${name}\`(${fields.map((f) => `\`${f}\``).join(', ')})`);
    }
    // relations -> foreign keys (the owning side is the one with `fields`)
    for (const field of model.fields) {
      if (field.kind !== 'object' || !field.relationFromFields || field.relationFromFields.length === 0) {
        continue;
      }
      const target = dmmf.datamodel.models.find((m) => m.name === field.type);
      if (!target) continue;
      const targetTable = tableNames.get(target.name);
      const constraintName = `${table}_${field.relationFromFields.join('_')}_fkey`;
      const onDeleteMap = {
        Cascade: 'CASCADE',
        Restrict: 'RESTRICT',
        NoAction: 'NO ACTION',
        SetNull: 'SET NULL',
        SetDefault: 'SET DEFAULT',
      };
      const onDelete = onDeleteMap[field.relationOnDelete] || 'RESTRICT';
      foreignKeys.push(
        `ALTER TABLE \`${table}\` ADD CONSTRAINT \`${constraintName}\` FOREIGN KEY (${field.relationFromFields
          .map((f) => `\`${f}\``)
          .join(', ')}) REFERENCES \`${targetTable}\`(${field.relationToFields
          .map((f) => `\`${f}\``)
          .join(', ')}) ON DELETE ${onDelete} ON UPDATE CASCADE;`,
      );
      // Prisma creates a supporting index for FK columns when none exists.
      if (field.relationFromFields.length === 1) {
        const col = field.relationFromFields[0];
        const indexName = `${table}_${col}_idx`;
        const hasIndex = indexes.some((i) => i.includes(`(\`${col}\`)`) || i.includes(`\`${col}\`, `));
        if (!hasIndex) {
          indexes.push(`    INDEX \`${indexName}\`(\`${col}\`)`);
        }
      }
    }

    // enum-typed columns need no special handling — MySQL enums are inline.

    const pkLine = `    PRIMARY KEY (${primaryKeyFields.map((f) => `\`${f}\``).join(', ')})`;
    const bodyLines = [...columns, pkLine, ...indexes].filter(Boolean);

    creates.push(
      `-- CreateTable\nCREATE TABLE \`${table}\` (\n${bodyLines.join(',\n')}\n) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=DYNAMIC;`,
    );
    alters.push(...foreignKeys);
  }

  return { creates, alters, tableNames };
}

async function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const outFile = outIndex !== -1 ? args[outIndex + 1] : null;

  const { datamodel, dmmf } = await loadDmmf();
  const { creates, alters, tableNames } = buildStatements(datamodel, dmmf);

  const sql = [
    '-- FEMS initial schema',
    '-- Generated from prisma/schema.prisma (DMMF) — MySQL 5.7+/8.x compatible.',
    '-- Apply with: npm run db:migrate',
    '',
    ...creates,
    '',
    '-- AddForeignKey',
    ...alters,
    '',
  ].join('\n\n');

  if (outFile) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, sql);
    log('migration', `wrote ${outFile} (${tableNames.size} tables, ${alters.length} foreign keys)`);
  } else {
    process.stdout.write(sql);
  }
}

main().catch((error) => {
  console.error('[migration] failed:', error.message);
  process.exit(1);
});
