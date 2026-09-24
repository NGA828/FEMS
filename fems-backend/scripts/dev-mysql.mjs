#!/usr/bin/env node
/**
 * Local MySQL for development.
 *
 * The API needs a real MySQL/MariaDB server: Prisma talks to it through the
 * MariaDB driver and the migration SQL is MySQL-specific. `docker compose up -d`
 * is the documented path, but sandboxes and CI images without a container runtime
 * can use the MySQL server that is distributed as an npm package:
 *
 *   npm install --prefix ../tools mysql-server-5.6-linux-x64@5.6.24002
 *   node scripts/dev-mysql.mjs start      # start + create db/user if needed
 *   node scripts/dev-mysql.mjs status
 *   node scripts/dev-mysql.mjs stop
 *
 * Configuration (all optional):
 *   FEMS_MYSQL_SERVER_DIR  directory containing `mysqld` (default: ../tools/node_modules/mysql-server-5.6-linux-x64/server)
 *   FEMS_MYSQL_DATA_DIR    data directory (default: <server dir>/data/mysql)
 *   FEMS_MYSQL_PORT        TCP port (default 3306)
 *   DATABASE_URL           used to derive the database name, user and password
 *
 * Only for development: the bundled 5.6 server has no production hardening and is
 * never used by the deployed system.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(here, '..');

function loadEnvFile() {
  const envPath = path.join(backendDir, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}
loadEnvFile();

const PACKAGE_RELATIVE = ['node_modules', 'mysql-server-5.6-linux-x64', 'server'];

/** Where the bundled server may live, in order of preference. */
function resolveServerDir() {
  if (process.env.FEMS_MYSQL_SERVER_DIR) return process.env.FEMS_MYSQL_SERVER_DIR;
  const candidates = [
    path.join(backendDir, ...PACKAGE_RELATIVE),
    path.resolve(backendDir, '..', 'tools', ...PACKAGE_RELATIVE),
    path.resolve(backendDir, '..', '..', 'tools', ...PACKAGE_RELATIVE),
    path.join(process.env.HOME ?? '/home/user', 'tools', ...PACKAGE_RELATIVE),
  ];
  return candidates.find((candidate) => existsSync(path.join(candidate, 'mysqld'))) ?? candidates[0];
}

const serverDir = resolveServerDir();
const dataDir = process.env.FEMS_MYSQL_DATA_DIR ?? path.join(serverDir, 'data', 'mysql');
const port = Number(process.env.FEMS_MYSQL_PORT ?? 3306);
const socketPath = path.join(dataDir, '..', 'mysql.sock');
const pidFile = path.join(dataDir, '..', 'mysql.pid');
const logFile = path.join(dataDir, '..', 'mysql.log');

const databaseUrl = process.env.DATABASE_URL ?? 'mysql://fems:fems@127.0.0.1:3306/fems';
const parsedUrl = new URL(databaseUrl);
const dbName = parsedUrl.pathname.replace(/^\//, '') || 'fems';
const dbUser = decodeURIComponent(parsedUrl.username || 'fems');
const dbPassword = decodeURIComponent(parsedUrl.password || 'fems');

function assertServerPresent() {
  const binary = path.join(serverDir, 'mysqld');
  if (!existsSync(binary)) {
    console.error(`[dev-mysql] mysqld not found at ${binary}\n`);
    console.error('Install it first:  npm install --prefix /home/user/tools mysql-server-5.6-linux-x64@5.6.24002');
    console.error('or point FEMS_MYSQL_SERVER_DIR at a directory containing mysqld.');
    process.exit(1);
  }
  return binary;
}

function isRunning() {
  try {
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs = 40_000) {
  const mariadb = await import('mariadb');
  const driver = mariadb.default ?? mariadb;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const connection = await driver.createConnection({
        host: '127.0.0.1',
        port,
        socketPath,
        user: 'root',
        password: '',
        connectTimeout: 3000,
        allowPublicKeyRetrieval: true,
      });
      await connection.end();
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return false;
}

async function withRootConnection(work) {
  const mariadb = await import('mariadb');
  const driver = mariadb.default ?? mariadb;
  const connection = await driver.createConnection({
    host: '127.0.0.1',
    port,
    socketPath,
    user: 'root',
    password: '',
    multipleStatements: true,
    connectTimeout: 10_000,
  });
  try {
    return await work(connection);
  } finally {
    await connection.end().catch(() => {});
  }
}

async function bootstrap() {
  await withRootConnection(async (connection) => {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    // MySQL 5.6 has no `CREATE USER IF NOT EXISTS`: GRANT creates or updates the account.
    await connection.query(`GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${dbUser}'@'localhost' IDENTIFIED BY '${dbPassword}'`);
    await connection.query(`GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${dbUser}'@'127.0.0.1' IDENTIFIED BY '${dbPassword}'`);
    await connection.query(`GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${dbUser}'@'%' IDENTIFIED BY '${dbPassword}'`);
    await connection.query('FLUSH PRIVILEGES');
    const [{ version }] = await connection.query('SELECT VERSION() AS version');
    console.log(`[dev-mysql] database ready: ${dbName} (owner ${dbUser}) on MySQL ${version}`);
  });
}

async function start() {
  const binary = assertServerPresent();
  if (isRunning()) {
    console.log('[dev-mysql] already running');
    await bootstrap().catch((error) => console.error('[dev-mysql] bootstrap failed:', error.message));
    return;
  }
  mkdirSync(path.dirname(socketPath), { recursive: true });

  const child = spawn(
    binary,
    [
      '--basedir',
      serverDir,
      '--datadir',
      dataDir,
      '--port',
      String(port),
      `--socket=${socketPath}`,
      `--pid-file=${pidFile}`,
      `--log-error=${logFile}`,
      '--bind-address=0.0.0.0',
      '--max_connections=200',
      '--skip-name-resolve',
      '--character-set-server=utf8mb4',
      '--collation-server=utf8mb4_unicode_ci',
    ],
    {
      cwd: serverDir,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, LD_LIBRARY_PATH: `${serverDir}:${process.env.LD_LIBRARY_PATH ?? ''}` },
    },
  );
  child.unref();
  console.log(`[dev-mysql] starting mysqld (pid ${child.pid}) on port ${port}…`);

  const ready = await waitForServer();
  if (!ready) {
    console.error(`[dev-mysql] server did not become ready; see ${logFile}`);
    process.exit(1);
  }
  await bootstrap();
}

async function stop() {
  if (!isRunning()) {
    console.log('[dev-mysql] not running');
    return;
  }
  await withRootConnection(async (connection) => {
    await connection.query('SHUTDOWN');
  }).catch(() => {});
  console.log('[dev-mysql] stopped');
}

async function status() {
  console.log(`[dev-mysql] server dir : ${serverDir}`);
  console.log(`[dev-mysql] data dir   : ${dataDir}`);
  console.log(`[dev-mysql] port       : ${port}`);
  console.log(`[dev-mysql] running    : ${isRunning() ? 'yes' : 'no'}`);
  if (!isRunning()) return;
  await withRootConnection(async (connection) => {
    const [{ version }] = await connection.query('SELECT VERSION() AS version');
    const tables = await connection.query(
      `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = '${dbName}'`,
    );
    console.log(`[dev-mysql] version    : ${version}`);
    console.log(`[dev-mysql] tables     : ${tables[0].count} in ${dbName}`);
  }).catch((error) => console.error(`[dev-mysql] cannot query: ${error.message}`));
}

const command = process.argv[2] ?? 'start';
const commands = { start, stop, status, bootstrap, restart: async () => {
  await stop();
  await start();
} };

if (!commands[command]) {
  console.error(`Usage: node scripts/dev-mysql.mjs [${Object.keys(commands).join('|')}]`);
  process.exit(1);
}

await commands[command]();
