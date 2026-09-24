#!/usr/bin/env node
/**
 * Creates (or resets) the first FEMS administrator account.
 *
 * Usage:
 *   node scripts/create-admin.mjs --email admin@fems.cm [--password 'Secr3t...'] [--name "Awa Mballa"]
 *
 * - The password is never hardcoded: pass it on the command line, set
 *   FEMS_ADMIN_PASSWORD, or let the script generate a strong one (printed once).
 * - Idempotent: re-running with an existing email updates the password and
 *   ensures the ADMINISTRATOR role is attached.
 * - Roles/permissions themselves are synchronised by the API at boot
 *   (RbacService) or by `npm run db:seed`.
 */
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const { PrismaMariaDb } = require('@prisma/adapter-mariadb');
const bcrypt = require('bcryptjs');

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      args[key] = value;
    }
  }
  return args;
}

function generatePassword() {
  return `Fems-${randomBytes(9).toString('base64url')}`;
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  const email = (args.email ?? process.env.FEMS_ADMIN_EMAIL ?? '').toLowerCase().trim();
  if (!email) {
    console.error('An administrator email is required: --email admin@fems.cm');
    process.exit(1);
  }

  const password = args.password ?? process.env.FEMS_ADMIN_PASSWORD ?? generatePassword();
  const generated = !args.password && !process.env.FEMS_ADMIN_PASSWORD;
  const [firstName, ...rest] = (args.name ?? 'FEMS Administrator').split(' ');
  const lastName = rest.join(' ') || 'Administrator';

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set (see .env.example).');
    process.exit(1);
  }

  const url = new URL(databaseUrl);
  const prisma = new PrismaClient({
    adapter: new PrismaMariaDb({
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ''),
      connectionLimit: 5,
      allowPublicKeyRetrieval: true,
    }),
  });

  try {
    const role = await prisma.role.findUnique({ where: { name: 'ADMINISTRATOR' } });
    if (!role) {
      console.error('The ADMINISTRATOR role does not exist yet. Start the API once or run `npm run db:seed`.');
      process.exit(1);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const existing = await prisma.user.findFirst({ where: { email } });

    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: {
            passwordHash,
            status: 'ACTIVE',
            emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
            deletedAt: null,
            failedLoginCount: 0,
            lockedUntil: null,
          },
        })
      : await prisma.user.create({
          data: {
            email,
            passwordHash,
            firstName,
            lastName,
            status: 'ACTIVE',
            emailVerifiedAt: new Date(),
            preferredLanguage: 'fr',
          },
        });

    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      update: {},
      create: { userId: user.id, roleId: role.id },
    });

    console.log(`Administrator ${existing ? 'updated' : 'created'}: ${user.email} (${user.id})`);
    if (generated) {
      console.log('');
      console.log('Generated password (store it securely, it is shown only once):');
      console.log(`  ${password}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Failed to create the administrator:', error.message);
  process.exit(1);
});
