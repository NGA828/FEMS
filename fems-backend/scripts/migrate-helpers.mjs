/** Shared migration helpers: file discovery, checksums and _prisma_migrations bookkeeping. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { migrationsDir } from './lib/schema-tools.mjs';

export const MIGRATIONS_TABLE = '_prisma_migrations';

export function listMigrationFiles() {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const file = path.join(migrationsDir, name, 'migration.sql');
      if (!fs.existsSync(file)) return null;
      const sql = fs.readFileSync(file, 'utf8');
      return {
        name,
        sql,
        checksum: crypto.createHash('sha256').update(sql).digest('hex'),
      };
    })
    .filter(Boolean);
}

export async function ensureMigrationsTable(conn) {
  await conn.query(
    `CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (
      id VARCHAR(36) NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      finished_at DATETIME(3) NULL,
      migration_name VARCHAR(255) NOT NULL,
      logs TEXT NULL,
      rolled_back_at DATETIME(3) NULL,
      started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      applied_steps_count INT UNSIGNED NOT NULL DEFAULT 0,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  );
}

export async function appliedMigrations(conn) {
  await ensureMigrationsTable(conn);
  const rows = await conn.query(
    `SELECT migration_name, checksum, finished_at, rolled_back_at FROM \`${MIGRATIONS_TABLE}\` ORDER BY started_at ASC`,
  );
  return rows.filter((row) => row.finished_at && !row.rolled_back_at);
}
