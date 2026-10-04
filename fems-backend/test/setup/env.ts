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

// Configuration is cached on its first read, so set the E2E throttle ceiling
// before calling appConfig() or importing the application module.
process.env.NODE_ENV = process.env.NODE_ENV ?? 'development';
process.env.FEMS_ENV = process.env.FEMS_ENV ?? 'development';
process.env.FEMS_LOG_LEVEL = process.env.FEMS_LOG_LEVEL ?? 'error';
const throttleLimit = process.env.E2E_THROTTLE_LIMIT ?? '5000';
process.env.THROTTLE_LIMIT = throttleLimit;
process.env.THROTTLE_AUTH_LIMIT = throttleLimit;
process.env.THROTTLE_AUTH_STRICT_LIMIT = throttleLimit;

if (!appConfig().databaseUrl) {
  throw new Error(
    'DATABASE_URL is not configured. Run `npm run dev:setup` (it creates fems-backend/.env and starts MySQL), then `npm run db:seed`.',
  );
}
