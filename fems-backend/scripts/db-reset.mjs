#!/usr/bin/env node
/**
 * Drop and recreate the FEMS database, then re-apply all migrations and seed.
 *   node scripts/db-reset.mjs [--skip-seed]
 */
import { connectDatabase, log, parseMysqlUrl, resolveDatabaseUrl } from './lib/schema-tools.mjs';

const url = resolveDatabaseUrl();
const options = parseMysqlUrl(url);
const database = options.database;

const conn = await connectDatabase(url.replace(/\/[^/?]+(\?|$)/, '/'));
try {
  log('reset', `dropping database \`${database}\``);
  await conn.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await conn.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
} finally {
  await conn.end();
}

const { execFileSync } = await import('node:child_process');
execFileSync(process.execPath, ['scripts/db-migrate.mjs'], { stdio: 'inherit', cwd: process.cwd() });
if (!process.argv.includes('--skip-seed')) {
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/seed-runner.mjs'], { stdio: 'inherit', cwd: process.cwd() });
}
log('reset', 'done');
