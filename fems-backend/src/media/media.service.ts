import { Injectable, NotFoundException } from '@nestjs/common';
import { MediaOwnerType, MediaRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Descriptor returned by list endpoints — the binary `data` is never inlined. */
export interface MediaDescriptor {
  id: string;
  ownerType: MediaOwnerType;
  ownerId: string | null;
  role: MediaRole;
  title: string | null;
  altText: string | null;
  credit: string | null;
  mimeType: string;
  width: number;
  height: number;
  sizeBytes: number;
  isDemo: boolean;
  sortOrder: number;
  /** Absolute path (below the API base) the client can hand to an <Image>. */
  url: string;
}

export interface MediaQuery {
  ownerType?: MediaOwnerType;
  ownerId?: string;
  ownerIds?: string[];
  role?: MediaRole;
  limit?: number;
}

const DESCRIPTOR_SELECT = {
  id: true,
  ownerType: true,
  ownerId: true,
  role: true,
  title: true,
  altText: true,
  credit: true,
  mimeType: true,
  width: true,
  height: true,
  sizeBytes: true,
  isDemo: true,
  sortOrder: true,
} satisfies Prisma.MediaAssetSelect;

@Injectable()
export class MediaService {
  constructor(private readonly prisma: PrismaService) {}

  private toDescriptor(row: Omit<Prisma.MediaAssetGetPayload<{ select: typeof DESCRIPTOR_SELECT }>, 'data'>): MediaDescriptor {
    return { ...row, url: `/media/${row.id}` };
  }

  /** Public media descriptors for the landing page and record cards (no bytes). */
  async list(query: MediaQuery): Promise<MediaDescriptor[]> {
    const where: Prisma.MediaAssetWhereInput = {};
    if (query.ownerType) where.ownerType = query.ownerType;
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.ownerIds && query.ownerIds.length > 0) where.ownerId = { in: query.ownerIds };
    if (query.role) where.role = query.role;

    const rows = await this.prisma.mediaAsset.findMany({
      where,
      select: DESCRIPTOR_SELECT,
      orderBy: [{ ownerType: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: Math.min(query.limit ?? 100, 200),
    });
    return rows.map((row) => this.toDescriptor(row));
  }

  /** One cover descriptor per owner id, used by catalogue cards. */
  async covers(ownerType: MediaOwnerType, ownerIds: string[]): Promise<Record<string, MediaDescriptor>> {
    if (ownerIds.length === 0) return {};
    const rows = await this.prisma.mediaAsset.findMany({
      where: { ownerType, ownerId: { in: ownerIds }, role: MediaRole.COVER },
      select: DESCRIPTOR_SELECT,
      orderBy: { sortOrder: 'asc' },
    });
    const byOwner: Record<string, MediaDescriptor> = {};
    for (const row of rows) {
      if (!row.ownerId) continue;
      // First (lowest sortOrder) cover wins per owner.
      if (!byOwner[row.ownerId]) byOwner[row.ownerId] = this.toDescriptor(row);
    }
    return byOwner;
  }

  /** Binary payload for streaming. */
  async getRaw(id: string): Promise<{ data: Buffer; mimeType: string; sizeBytes: number; altText: string | null }> {
    const row = await this.prisma.mediaAsset.findUnique({
      where: { id },
      select: { data: true, mimeType: true, sizeBytes: true, altText: true },
    });
    if (!row) {
      throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', message: 'The requested media asset does not exist.' });
    }
    return { data: Buffer.from(row.data), mimeType: row.mimeType, sizeBytes: row.sizeBytes, altText: row.altText };
  }
}
