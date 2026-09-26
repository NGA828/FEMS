import { MediaOwnerType, MediaRole } from '@prisma/client';
import { buildMediaRows, readJpegDimensions, type SeedMediaFile } from '../../prisma/seed-media';

/** Minimal JPEG: SOI + SOF0 reporting height=2, width=3. */
function tinyJpeg(): Buffer {
  return Buffer.from([
    0xff, 0xd8, // SOI
    0xff, 0xc0, // SOF0
    0x00, 0x0b, // segment length = 11
    0x08, // precision
    0x00, 0x02, // height = 2
    0x00, 0x03, // width = 3
    0x01, // 1 component
    0x01, 0x11, 0x00, // component spec
  ]);
}

const ownerIds: Record<string, string> = { djoum: 'forest-djoum', korup: 'pa-korup' };

function ownerIdFor(ownerType: MediaOwnerType, key: string): string | null {
  if (ownerType === MediaOwnerType.FOREST) return ownerIds[key] ?? null;
  if (ownerType === MediaOwnerType.PROTECTED_AREA) return ownerIds[key] ?? null;
  return null;
}

describe('readJpegDimensions', () => {
  it('reads width/height from the SOF0 marker', () => {
    expect(readJpegDimensions(tinyJpeg())).toEqual({ width: 3, height: 2 });
  });

  it('returns null for non-JPEG input', () => {
    expect(readJpegDimensions(Buffer.from('not a jpeg'))).toBeNull();
  });
});

describe('buildMediaRows', () => {
  const files: SeedMediaFile[] = [
    { name: 'hero-canopy.jpg', buffer: tinyJpeg() },
    { name: 'hero-logs.jpg', buffer: tinyJpeg() },
    { name: 'forest-djoum.jpg', buffer: tinyJpeg() },
    { name: 'forest-unknown.jpg', buffer: tinyJpeg() },
    { name: 'pa-korup.jpg', buffer: tinyJpeg() },
    { name: 'unrelated.txt', buffer: Buffer.from('x') },
  ];

  const rows = buildMediaRows(files, ownerIdFor);

  it('assigns hero frames an incrementing sort order and null owner', () => {
    const heroes = rows.filter((row) => row.ownerType === MediaOwnerType.HERO);
    expect(heroes).toHaveLength(2);
    expect(heroes.map((row) => row.sortOrder)).toEqual([0, 1]);
    expect(heroes.every((row) => row.ownerId === null && row.role === MediaRole.HERO)).toBe(true);
  });

  it('maps forest covers to their deterministic owner id', () => {
    const forest = rows.find((row) => row.title === 'Djoum');
    expect(forest?.ownerType).toBe(MediaOwnerType.FOREST);
    expect(forest?.ownerId).toBe('forest-djoum');
    expect(forest?.role).toBe(MediaRole.COVER);
  });

  it('skips files whose owner is not part of the seed', () => {
    expect(rows.some((row) => row.ownerId === null && row.ownerType === MediaOwnerType.FOREST)).toBe(false);
    expect(rows.some((row) => row.title.toLowerCase().includes('unknown'))).toBe(false);
  });

  it('ignores non-image files', () => {
    expect(rows.some((row) => row.mimeType === 'text/plain')).toBe(false);
    expect(rows).toHaveLength(4); // 2 heroes + djoum + korup
  });

  it('records the parsed JPEG dimensions', () => {
    expect(rows[0].width).toBe(3);
    expect(rows[0].height).toBe(2);
  });
});
