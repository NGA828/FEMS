/**
 * Database-resident demonstration imagery.
 *
 * The landing page and the record cards render photography that is seeded into
 * the `media_assets` table (binary `LONGBLOB`), not hot-linked stock URLs — so the
 * catalogue is genuinely data-driven and works fully offline. Each JPEG in
 * `prisma/seed-assets/media/` is mapped to an owner (forest / protected area /
 * species / hero frame / brand) by filename prefix, read from disk, and upserted
 * with a deterministic id so re-running the seed updates the same rows.
 *
 * Missing files are skipped rather than failing, which keeps the seed robust
 * while the asset library grows.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { MediaOwnerType, MediaRole } from '@prisma/client';
import type { PrismaService } from '../src/prisma/prisma.service';

export const MEDIA_DIR = path.join(__dirname, 'seed-assets', 'media');

/** Same deterministic id scheme as the rest of the seed (see scripts/lib/demo-id.mjs). */
export function demoId(kind: string, key: string | number): string {
  const digest = createHash('sha1').update(`fems-demo:${kind}:${key}`).digest('hex');
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `5${digest.slice(13, 16)}`,
    ((parseInt(digest.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + digest.slice(17, 20),
    digest.slice(20, 32),
  ].join('-');
}

/**
 * Parse a JPEG buffer's SOF0/SOF2 marker to recover the true pixel dimensions.
 * Returns null for non-JPEG input so the caller can fall back safely.
 */
export function readJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      if (width > 0 && height > 0) return { width, height };
      return null;
    }
    const length = buffer.readUInt16BE(offset + 2);
    offset += 2 + length;
  }
  return null;
}

export interface SeedMediaFile {
  name: string;
  buffer: Buffer;
}

export interface SeedMediaRow {
  id: string;
  ownerType: MediaOwnerType;
  ownerId: string | null;
  role: MediaRole;
  title: string;
  altText: string;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  data: Buffer;
  sortOrder: number;
}

function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Pure mapping of media files → insertable rows. Separated from any database
 * access so it is directly unit-testable. `ownerIdFor` resolves a semantic key to
 * the deterministic owner id created earlier in the seed.
 */
export function buildMediaRows(
  files: SeedMediaFile[],
  ownerIdFor: (ownerType: MediaOwnerType, key: string) => string | null,
): SeedMediaRow[] {
  const rows: SeedMediaRow[] = [];
  let heroOrder = 0;

  for (const file of files) {
    const base = path.basename(file.name, path.extname(file.name));
    if (!/\.(jpe?g|png|webp)$/i.test(file.name)) continue;

    let ownerType: MediaOwnerType;
    let role: MediaRole;
    let key: string;
    let title: string;

    if (base.startsWith('hero-')) {
      ownerType = MediaOwnerType.HERO;
      role = MediaRole.HERO;
      key = base;
      title = titleFromSlug(base.replace(/^hero-/, ''));
    } else if (base.startsWith('forest-')) {
      ownerType = MediaOwnerType.FOREST;
      role = MediaRole.COVER;
      key = base.replace(/^forest-/, '');
      title = titleFromSlug(key);
    } else if (base.startsWith('pa-')) {
      ownerType = MediaOwnerType.PROTECTED_AREA;
      role = MediaRole.COVER;
      key = base.replace(/^pa-/, '');
      title = titleFromSlug(key);
    } else if (base.startsWith('species-')) {
      ownerType = MediaOwnerType.TREE_SPECIES;
      role = MediaRole.COVER;
      key = base.replace(/^species-/, '');
      title = titleFromSlug(key);
    } else if (base.startsWith('brand-')) {
      ownerType = MediaOwnerType.BRAND;
      role = MediaRole.LOGO;
      key = base;
      title = titleFromSlug(base.replace(/^brand-/, ''));
    } else {
      continue;
    }

    const isUnowned = ownerType === MediaOwnerType.HERO || ownerType === MediaOwnerType.BRAND;
    const ownerId = isUnowned ? null : ownerIdFor(ownerType, key);
    // A forest / protected-area / species file whose owner is not part of the
    // seed is ignored rather than left dangling.
    if (ownerId === null && !isUnowned) continue;

    const dimensions = readJpegDimensions(file.buffer) ?? { width: 1408, height: 768 };
    const sortOrder = ownerType === MediaOwnerType.HERO ? heroOrder++ : 0;
    const lower = file.name.toLowerCase();

    rows.push({
      id: demoId('media', base),
      ownerType,
      ownerId,
      role,
      title,
      altText: title,
      mimeType: lower.endsWith('.png') ? 'image/png' : lower.endsWith('.webp') ? 'image/webp' : 'image/jpeg',
      width: dimensions.width,
      height: dimensions.height,
      sizeBytes: file.buffer.length,
      data: file.buffer,
      sortOrder,
    });
  }

  return rows;
}

export function readMediaFiles(dir: string = MEDIA_DIR): SeedMediaFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /\.(jpe?g|png|webp)$/i.test(name))
    .sort()
    .map((name) => ({ name, buffer: readFileSync(path.join(dir, name)) }));
}

/** Upsert every media row that has a backing file on disk. */
export async function seedMedia(
  prisma: PrismaService,
  ownerIdFor: (ownerType: MediaOwnerType, key: string) => string | null,
  dir: string = MEDIA_DIR,
): Promise<number> {
  const rows = buildMediaRows(readMediaFiles(dir), ownerIdFor);
  for (const row of rows) {
    // Prisma's Bytes input wants a Uint8Array backed by a plain ArrayBuffer.
    const bytes = new Uint8Array(row.data.buffer, row.data.byteOffset, row.data.byteLength).slice();
    await prisma.mediaAsset.upsert({
      where: { id: row.id },
      update: {
        ownerType: row.ownerType,
        ownerId: row.ownerId,
        role: row.role,
        title: row.title,
        altText: row.altText,
        mimeType: row.mimeType,
        width: row.width,
        height: row.height,
        sizeBytes: row.sizeBytes,
        data: bytes,
        sortOrder: row.sortOrder,
      },
      create: {
        id: row.id,
        ownerType: row.ownerType,
        ownerId: row.ownerId,
        role: row.role,
        title: row.title,
        altText: row.altText,
        mimeType: row.mimeType,
        width: row.width,
        height: row.height,
        sizeBytes: row.sizeBytes,
        data: bytes,
        sortOrder: row.sortOrder,
        isDemo: true,
      },
    });
  }
  return rows.length;
}
