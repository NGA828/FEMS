/**
 * Environment for the end-to-end suites.
 *
 * The suites talk to the same MySQL database the API uses, so the flows exercise
 * real constraints, real transactions and the real seed data. Nothing here
 * replaces the database or the guards.
 */
// `../src/config/configuration` is how the API itself reads configuration: its
// import loads `fems-backend/.env`. Importing it here means the suites are
// configured exactly like the running server, and a missing file is reported as
// one actionable line instead of a Prisma stack trace.
import { appConfig } from '../../src/config/configuration';

if (!appConfig().databaseUrl) {
  throw new Error(
    'DATABASE_URL is not configured. Run `npm run dev:setup` (it creates fems-backend/.env and starts MySQL), then `npm run db:seed`.',
  );
}

process.env.NODE_ENV = process.env.NODE_ENV ?? 'development';
process.env.FEMS_ENV = process.env.FEMS_ENV ?? 'development';
// Keep the console readable: the suites assert on responses, not on log output.
process.env.FEMS_LOG_LEVEL = process.env.FEMS_LOG_LEVEL ?? 'error';

// The flow suites sign in as eight different roles and re-authenticate between
// steps. The guards stay exactly as they are in production (the throttler is
// still active) — only the ceiling is raised, so a burst of legitimate requests
// is not mistaken for abuse. The production defaults remain 120/min overall and
// 10/min on the auth routes.
process.env.THROTTLE_LIMIT = process.env.E2E_THROTTLE_LIMIT ?? '5000';
process.env.THROTTLE_AUTH_LIMIT = process.env.E2E_THROTTLE_LIMIT ?? '5000';
process.env.THROTTLE_AUTH_STRICT_LIMIT = process.env.E2E_THROTTLE_LIMIT ?? '5000';
