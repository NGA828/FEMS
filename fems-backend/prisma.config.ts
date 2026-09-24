import path from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7+ configuration.
 *
 * The datasource URL lives here (and never in schema.prisma). The application
 * runtime additionally passes a driver adapter (`@prisma/adapter-mariadb`) to
 * PrismaClient — see src/prisma/prisma.service.ts.
 *
 * `npx prisma migrate dev` / `prisma studio` work in normal (networked)
 * environments; in restricted environments use the WASM-based scripts:
 *   npm run db:migrate, npm run prisma:generate, npm run db:seed
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'node --import tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'mysql://fems:fems@127.0.0.1:3306/fems',
  },
});
