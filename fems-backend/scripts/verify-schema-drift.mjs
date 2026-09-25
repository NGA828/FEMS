#!/usr/bin/env node
/**
 * Offline schema drift check.
 *
 * Compares the live MySQL database with `prisma/schema.prisma` (read through the
 * WASM DMMF loader — no Prisma engine download required):
 *
 *   - every table exists
 *   - every column exists with the expected nullability and type family
 *   - every unique index declared in the schema exists
 *   - every foreign key the schema declares exists, with the same columns
 *
 * Exit code 0 = no drift, 1 = drift (the diff is printed).
 *
 * Usage: node scripts/verify-schema-drift.mjs [--verbose]
 */
import { loadSchemaIndexes } from './lib/schema-tools.mjs';

const NATIVE_TO_SQL = {
  VarChar: 'varchar',
  Char: 'char',
  Text: 'text',
  TinyText: 'tinytext',
  MediumText: 'mediumtext',
  LongText: 'longtext',
  LongBlob: 'longblob',
  Blob: 'blob',
  Int: 'int',
  UnsignedInt: 'int unsigned',
  SmallInt: 'smallint',
  TinyInt: 'tinyint',
  MediumInt: 'mediumint',
  BigInt: 'bigint',
  Decimal: 'decimal',
  Float: 'float',
  Double: 'double',
  DateTime: 'datetime',
  Date: 'date',
  Time: 'time',
  Timestamp: 'timestamp',
  Json: 'json',
  Boolean: 'tinyint',
  Bytes: 'longblob',
  Bit: 'bit',
  String: 'varchar',
};

/** Collapse a native type to the family MySQL reports in information_schema. */
function expectedSqlType(field) {
  if (field.type === 'Boolean') return 'tinyint';
  if (field.type === 'Int') return 'int';
  if (field.type === 'BigInt') return 'bigint';
  if (field.type === 'Decimal') return 'decimal';
  if (field.type === 'Float' || field.type === 'Double') return String(field.type).toLowerCase();
  if (field.type === 'DateTime') return 'datetime';
  if (field.type === 'Json') return 'longtext';
  const native = field.nativeType ?? (field.type === 'String' ? 'VarChar' : field.type);
  return NATIVE_TO_SQL[native] ?? String(native).toLowerCase();
}

function normaliseFound(columnType) {
  const value = String(columnType).toLowerCase();
  if (value.startsWith('tinyint')) return 'tinyint';
  if (value.startsWith('int')) return 'int';
  if (value.startsWith('bigint')) return 'bigint';
  if (value.startsWith('smallint')) return 'smallint';
  if (value.startsWith('mediumint')) return 'mediumint';
  if (value.startsWith('varchar')) return 'varchar';
  if (value.startsWith('char')) return 'char';
  if (value.startsWith('decimal')) return 'decimal';
  if (value.startsWith('datetime') || value.startsWith('timestamp')) return 'datetime';
  if (value.startsWith('longtext')) return 'longtext';
  if (value.startsWith('mediumtext')) return 'mediumtext';
  if (value.startsWith('text')) return 'text';
  if (value.startsWith('longblob') || value.startsWith('blob')) return 'longblob';
  return value;
}

const EXPECTED_ALIASES = { varchar: ['varchar', 'longtext'], text: ['text', 'longtext'], longtext: ['longtext', 'text'] };

function typeMatches(expected, found) {
  if (expected === found) return true;
  const aliases = EXPECTED_ALIASES[expected];
  return Array.isArray(aliases) ? aliases.includes(found) : false;
}

async function main() {
  const verbose = process.argv.includes('--verbose');
  const { connectDatabase, resolveDatabaseUrl } = await import('./lib/schema-tools.mjs');
  const url = resolveDatabaseUrl();
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
    process.exit(2);
  }

  const index = await loadSchemaIndexes();
  const connection = await connectDatabase(url);

  const [tableRows, columnRows, indexRows, fkRows] = await Promise.all([
    connection.query(
      `SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`,
    ),
    connection.query(
      `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()`,
    ),
    connection.query(
      `SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName, SEQ_IN_INDEX AS seq
       FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() ORDER BY SEQ_IN_INDEX`,
    ),
    connection.query(
      `SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName, COLUMN_NAME AS columnName,
              REFERENCED_TABLE_NAME AS referencedTable, REFERENCED_COLUMN_NAME AS referencedColumn
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
       ORDER BY ORDINAL_POSITION`,
    ),
  ]);

  const existingTables = new Set(tableRows.map((row) => row.tableName));
  const columnsByTable = new Map();
  for (const row of columnRows) {
    const map = columnsByTable.get(row.tableName) ?? new Map();
    map.set(row.columnName, row);
    columnsByTable.set(row.tableName, map);
  }
  const indexesByTable = new Map();
  for (const row of indexRows) {
    const map = indexesByTable.get(row.tableName) ?? new Map();
    const entry = map.get(row.indexName) ?? { unique: Number(row.nonUnique) === 0, columns: [] };
    entry.columns.push(row.columnName);
    map.set(row.indexName, entry);
    indexesByTable.set(row.tableName, map);
  }
  const fksByTable = new Map();
  for (const row of fkRows) {
    const map = fksByTable.get(row.tableName) ?? new Map();
    const entry = map.get(row.constraintName) ?? { columns: [], referencedTable: row.referencedTable };
    entry.columns.push(row.columnName);
    map.set(row.constraintName, entry);
    fksByTable.set(row.tableName, map);
  }

  const problems = [];
  let columnCount = 0;
  let fkCount = 0;

  for (const [modelName, model] of Object.entries(index.models)) {
    if (!existingTables.has(model.tableName)) {
      problems.push(`missing table ${model.tableName} (model ${modelName})`);
      continue;
    }
    const columns = columnsByTable.get(model.tableName);
    const tableIndexes = indexesByTable.get(model.tableName) ?? new Map();

    for (const [fieldName, field] of Object.entries(model.fields)) {
      columnCount += 1;
      const column = columns.get(field.dbName);
      if (!column) {
        problems.push(`missing column ${model.tableName}.${field.dbName} (${modelName}.${fieldName})`);
        continue;
      }
      if (field.kind === 'enum') {
        if (!String(column.columnType).toLowerCase().startsWith('enum(')) {
          problems.push(
            `type mismatch ${model.tableName}.${field.dbName}: expected enum for ${field.type}, found ${column.columnType}`,
          );
        }
        continue;
      }
      const expected = expectedSqlType(field);
      const found = normaliseFound(column.columnType);
      if (!typeMatches(expected, found)) {
        problems.push(
          `type mismatch ${model.tableName}.${field.dbName}: expected ${expected}, found ${column.columnType}`,
        );
      }
      if (field.isRequired !== (column.isNullable === 'NO')) {
        problems.push(
          `nullability mismatch ${model.tableName}.${field.dbName}: expected ${field.isRequired ? 'NOT NULL' : 'NULL'}, found ${column.isNullable}`,
        );
      }
    }

    for (const unique of model.uniqueIndexes) {
      const found = [...tableIndexes.values()].some(
        (entry) => entry.unique && unique.columns.every((column) => entry.columns.includes(column)),
      );
      if (!found) problems.push(`missing unique index ${model.tableName}(${unique.columns.join(', ')})`);
    }

    const tableFks = fksByTable.get(model.tableName) ?? new Map();
    for (const relation of model.relations) {
      fkCount += 1;
      const found = [...tableFks.values()].some(
        (entry) =>
          entry.referencedTable === relation.referencedTable &&
          relation.columns.every((column) => entry.columns.includes(column)),
      );
      if (!found) {
        problems.push(
          `missing foreign key ${model.tableName}(${relation.columns.join(', ')}) → ${relation.referencedTable} (relation ${modelName}.${relation.field})`,
        );
      }
    }
  }

  await connection.end();

  if (problems.length === 0) {
    console.log(
      `Schema drift check: OK — ${Object.keys(index.models).length} models, ${existingTables.size} tables, ` +
        `${columnCount} columns, ${fkCount} foreign keys verified, no drift.`,
    );
    process.exit(0);
  }

  console.error(`Schema drift detected (${problems.length} problem(s)):`);
  for (const problem of problems.slice(0, verbose ? problems.length : 40)) console.error(`  - ${problem}`);
  if (!verbose && problems.length > 40) console.error(`  … ${problems.length - 40} more (run with --verbose)`);
  process.exit(1);
}

main().catch((error) => {
  console.error('Drift check failed:', error.message);
  process.exit(1);
});
