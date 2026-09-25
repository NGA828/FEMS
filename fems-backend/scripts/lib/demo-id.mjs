/**
 * Deterministic identifier for the demonstration dataset.
 *
 * The API validates referenced ids with `@IsUUID()`, and production rows get a
 * UUID from Prisma — so the demo rows must be UUIDs as well, otherwise a seeded
 * record (a forest, a permit, a zone) could never be referenced from a payload.
 * The value is a name-based (version 5) UUID derived from a readable key, which
 * keeps the dataset reproducible across machines while the human-readable
 * identity lives in the `reference` / `code` / `permitNumber` columns.
 *
 * This is the exact algorithm `prisma/seed.ts` uses. The two copies must agree:
 * `npm run seed:verify` asserts it against the database (it looks up rows by the
 * computed value), so a drift between them fails the check instead of silently
 * producing a half-labelled dataset.
 */
import { createHash } from 'node:crypto';

export function demoId(kind, key) {
  const digest = createHash('sha1').update(`fems-demo:${kind}:${key}`).digest('hex');
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    ((parseInt(digest.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + digest.slice(17, 20),
    digest.slice(20, 32),
  ].join('-');
}

/** The analysis the seed produces and every seeded alert hangs off. */
export const SEEDED_ANALYSIS_ID = demoId('analysis', '0001');

/** The administrator account the seed creates. */
export const SEEDED_ADMIN_ID = demoId('user', 'admin');
