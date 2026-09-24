#!/usr/bin/env node
/**
 * Apply every pending migration in prisma/migrations — without native engines.
 *
 *   node scripts/db-migrate.mjs            # apply pending migrations
 *   node scripts/db-migrate.mjs --status   # show applied / pending without changes
 *
 * Migration files follow the standard Prisma layout, so on a machine with
 * network access `npx prisma migrate deploy` applies exactly the same history and
 * continues to work: this script maintains the same `_prisma_migrations` table
 * (id, checksum, started_at, finished_at, applied_steps_count).
 */
import crypto from 'node:crypto';
import { connectDatabase, log, resolveDatabaseUrl } from './lib/schema-tools.mjs';
import { appliedMigrations, listMigrationFiles, MIGRATIONS_TABLE } from './migrate-helpers.mjs';

const statusOnly = process.argv.includes('--status');
const url = resolveDatabaseUrl();
const migrations = listMigrationFiles();

if (migrations.length === 0) {
  log('migrate', 'no migration directories found in prisma/migrations');
  process.exit(1);
}

const conn = await connectDatabase(url);
try {
  const applied = await appliedMigrations(conn);
  const appliedNames = new Set(applied.map((row) => row.migration_name));
  const pending = migrations.filter((migration) => !appliedNames.has(migration.name));

  log('migrate', `${applied.length} applied, ${pending.length} pending (database: ${new URL(url).pathname.slice(1)})`);

  for (const migration of applied) {
    const local = migrations.find((m) => m.name === migration.migration_name);
    if (local && local.checksum !== migration.checksum) {
      log('migrate', `WARNING: checksum mismatch for ${migration.migration_name} — the file changed after it was applied`);
    }
  }

  if (statusOnly) {
    for (const migration of pending) log('migrate', `pending: ${migration.name}`);
    process.exit(0);
  }

  for (const migration of pending) {
    log('migrate', `applying ${migration.name} ...`);
    const id = crypto.randomUUID();
    const startedAt = new Date();
    await conn.query(
      `INSERT INTO \`${MIGRATIONS_TABLE}\` (id, checksum, migration_name, started_at, applied_steps_count) VALUES (?, ?, ?, ?, ?)`,
      [id, migration.checksum, migration.name, startedAt, 0],
    );
    try {
      // MySQL DDL is not transactional: run statement by statement so a failure
      // reports the exact step (same behaviour as the Prisma migration engine).
      const statements = migration.sql
        .split(/;\s*\n/)
        .map((statement) => statement.replace(/^\s*--[^\n]*\n?/gm, '').trim())
        .filter(Boolean);
      let applied = 0;
      for (const statement of statements) {
        try {
          await conn.query(statement);
          applied += 1;
        } catch (statementError) {
          throw new Error(
            `step ${applied + 1}/${statements.length} failed: ${statementError.message.split('\n')[0]}\n${statement.slice(0, 400)}`,
          );
        }
      }
      await conn.query(
        `UPDATE \`${MIGRATIONS_TABLE}\` SET finished_at = ?, applied_steps_count = ? WHERE id = ?`,
        [new Date(), applied, id],
      );
      log('migrate', `applied ${migration.name} (${applied} steps)`);
    } catch (error) {
      await conn.query(
        `UPDATE \`${MIGRATIONS_TABLE}\` SET logs = ? WHERE id = ?`,
        [String(error.message || error).slice(0, 2000), id],
      );
      throw new Error(`migration ${migration.name} failed: ${error.message}`);
    }
  }
  log('migrate', 'database is up to date');
} finally {
  await conn.end();
}
