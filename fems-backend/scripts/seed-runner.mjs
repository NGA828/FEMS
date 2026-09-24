#!/usr/bin/env node
/**
 * Run prisma/seed.ts through tsx with the backend .env loaded, mirroring
 * `npx prisma db seed` but without requiring the Prisma CLI.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { backendRoot, loadDotEnv, log } from './lib/schema-tools.mjs';

loadDotEnv(path.join(backendRoot, '.env'));
const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', path.join(backendRoot, 'prisma', 'seed.ts')],
  { stdio: 'inherit', cwd: backendRoot, env: process.env },
);
if (result.status !== 0) {
  log('seed', `seed script exited with code ${result.status}`);
  process.exit(result.status ?? 1);
}
