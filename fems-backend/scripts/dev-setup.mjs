#!/usr/bin/env node
/**
 * Development bootstrap.
 *
 * This sandbox resyncs the workspace between sessions, which removes everything
 * that lives under `node_modules` — including the MySQL server binary this
 * project uses locally — and any ignored file such as `.env`. Losing those is
 * recoverable but tedious, so this script rebuilds the whole local environment
 * from scratch in one command:
 *
 *   1. `.env`            copied from `.env.example`, with random development JWT
 *                        secrets; an existing `.env` is never overwritten.
 *   2. dependencies      `npm install` in the backend (if needed).
 *   3. MySQL 5.6 server  installed from the npm package into `$HOME/mysql-server`,
 *                        *outside* `node_modules`, so a resync cannot delete it.
 *   4. database          started, then migrated.
 *
 * It is idempotent: running it on a healthy checkout does nothing destructive and
 * reports what it found. Run `npm run dev:setup`, then `npm run db:seed`.
 *
 * The MySQL binary distribution is only used because this sandbox has no package
 * manager access; a normal development machine points DATABASE_URL at its own
 * MySQL/MariaDB and never needs step 3.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = process.env.HOME ?? homedir();
const MYSQL_PACKAGE = 'mysql-server-5.6-linux-x64@5.6.24002';
const mysqlInstallDir = process.env.FEMS_MYSQL_SERVER_DIR ?? path.join(home, 'mysql-server');

const steps = [];
function log(step, message) {
  steps.push(step);
  console.log(`[dev:setup] ${step.padEnd(10)} ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? backendDir,
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (result.status !== 0 && !options.allowFailure) {
    const detail = options.capture ? (result.stderr || result.stdout || '').trim().split('\n').slice(-3).join(' ') : '';
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return result;
}

function ensureEnvFile() {
  const envPath = path.join(backendDir, '.env');
  const examplePath = path.join(backendDir, '.env.example');
  if (existsSync(envPath)) {
    log('env', 'fems-backend/.env already present — left untouched');
    return;
  }
  if (!existsSync(examplePath)) throw new Error('fems-backend/.env.example is missing; cannot build a development .env');

  const secret = () => randomBytes(48).toString('base64url');
  const contents = readFileSync(examplePath, 'utf8')
    .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${secret()}`)
    .replace(/^JWT_REFRESH_SECRET=.*$/m, `JWT_REFRESH_SECRET=${secret()}`);

  writeFileSync(envPath, contents, { mode: 0o600 });
  log('env', 'created fems-backend/.env from .env.example with random JWT secrets');
}

function ensureDependencies() {
  const marker = path.join(backendDir, 'node_modules', '.bin', 'nest');
  if (existsSync(marker)) {
    log('deps', 'backend dependencies present');
    return;
  }
  log('deps', 'installing backend dependencies…');
  run('npm', ['install', '--no-audit', '--no-fund']);
}

function ensureMysqlServer() {
  if (existsSync(path.join(mysqlInstallDir, 'mysqld'))) {
    log('mysql', `server binary present at ${mysqlInstallDir}`);
    return;
  }

  log('mysql', `installing ${MYSQL_PACKAGE} …`);
  const fetchDir = path.join(home, '.fems-mysql-fetch');
  mkdirSync(fetchDir, { recursive: true });
  writeFileSync(path.join(fetchDir, 'package.json'), JSON.stringify({ name: 'fems-mysql-fetch', private: true }, null, 2));
  run('npm', ['install', '--no-audit', '--no-fund', MYSQL_PACKAGE], { cwd: fetchDir });

  const source = path.join(fetchDir, 'node_modules', 'mysql-server-5.6-linux-x64', 'server');
  if (!existsSync(path.join(source, 'mysqld'))) {
    throw new Error(`the ${MYSQL_PACKAGE} package did not provide a mysqld binary at ${source}`);
  }

  // Copy out of node_modules: that directory is not preserved across a resync.
  rmSync(mysqlInstallDir, { recursive: true, force: true });
  run('cp', ['-r', source, mysqlInstallDir], { cwd: home });
  try {
    run('chmod', ['+x', path.join(mysqlInstallDir, 'mysqld')], { cwd: home, allowFailure: true });
  } catch {
    // chmod is best effort; the copy above usually preserves the mode.
  }
  log('mysql', `server installed to ${mysqlInstallDir} (outside node_modules)`);
}

function startDatabase() {
  log('database', 'starting MySQL and running migrations…');
  const env = { FEMS_MYSQL_SERVER_DIR: mysqlInstallDir };
  run('node', ['scripts/dev-mysql.mjs', 'start'], { env });
  run('node', ['scripts/db-migrate.mjs'], { env });
  log('database', 'schema is up to date');
}

function main() {
  console.log('[dev:setup] FEMS local environment\n');
  ensureEnvFile();
  ensureDependencies();
  ensureMysqlServer();
  startDatabase();

  console.log(`
[dev:setup] Ready. Next:
  npm run build          # compile the API
  node dist/main.js      # start it (or: npm run start:dev)
  npm run db:seed        # seed the Cameroon demonstration dataset
  npm run seed:verify    # confirm the seed is internally consistent
  npm run verify:access  # walk the RBAC matrix against the running API

  If DATABASE_URL points at your own MySQL/MariaDB server, the MySQL steps are
  unnecessary — just set .env and run npm run db:migrate.
`);
}

try {
  main();
} catch (error) {
  console.error(`\n[dev:setup] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
