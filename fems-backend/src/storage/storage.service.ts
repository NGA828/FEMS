import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { appConfig } from '../config/configuration';

export interface StoredFile {
  fileKey: string;
  fileUrl: string;
  sizeBytes: number;
  mimeType: string;
  checksum: string;
  originalName: string;
}

export interface UploadInput {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  /** Logical folder, e.g. `permits/documents`, `inspections/evidence`. */
  folder: string;
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
  'video/mp4',
  'audio/mpeg',
  'audio/mp4',
  'application/geo+json',
  'application/json',
]);

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
  'video/mp4': 'mp4',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'application/json': 'json',
  'application/geo+json': 'geojson',
};

/**
 * File storage.
 *
 * The default driver writes to the local filesystem (STORAGE_LOCAL_DIR) — the
 * same interface is used for S3-style object storage in production, selected
 * through STORAGE_DRIVER. Uploads are validated by MIME type and size, stored
 * under an unguessable key, and hashed (SHA-256) so integrity can be verified.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  get driver(): 'local' | 's3' {
    return appConfig().storage.driver;
  }

  get maxBytes(): number {
    return appConfig().storage.maxUploadSizeMb * 1024 * 1024;
  }

  private get rootDir(): string {
    return path.resolve(process.cwd(), appConfig().storage.localDir);
  }

  private ensureFolder(folder: string): string {
    const safeFolder = folder.replace(/\.\./g, '').replace(/^\/+/, '');
    const directory = path.join(this.rootDir, safeFolder);
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
    return directory;
  }

  async save(input: UploadInput): Promise<StoredFile> {
    if (!input.buffer || input.buffer.length === 0) {
      throw new BadRequestException({ code: 'EMPTY_FILE', message: 'The uploaded file is empty.' });
    }
    if (input.buffer.length > this.maxBytes) {
      throw new PayloadTooLargeException({
        code: 'FILE_TOO_LARGE',
        message: `The file exceeds the ${appConfig().storage.maxUploadSizeMb} MB limit.`,
      });
    }
    if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_FILE_TYPE',
        message: `Files of type ${input.mimeType} are not accepted. Allowed: images, PDF, Word, Excel, CSV, text, MP4, MP3.`,
      });
    }

    const extension =
      EXTENSION_BY_MIME[input.mimeType] ??
      (path.extname(input.originalName).replace('.', '').toLowerCase() || 'bin');
    const dateFolder = new Date().toISOString().slice(0, 10);
    const directory = this.ensureFolder(path.join(input.folder, dateFolder));
    const fileName = `${randomUUID()}.${extension}`;
    const absolutePath = path.join(directory, fileName);
    await fs.writeFile(absolutePath, input.buffer);

    const checksum = createHash('sha256').update(input.buffer).digest('hex');
    const fileKey = path
      .join(input.folder, dateFolder, fileName)
      .split(path.sep)
      .join('/');
    const publicUrl = appConfig().storage.publicUrl;
    const fileUrl = publicUrl ? `${publicUrl.replace(/\/$/, '')}/${fileKey}` : `/files/${fileKey}`;

    this.logger.log(`Stored ${fileKey} (${input.buffer.length} bytes, ${input.mimeType})`);
    return {
      fileKey,
      fileUrl,
      sizeBytes: input.buffer.length,
      mimeType: input.mimeType,
      checksum,
      originalName: input.originalName,
    };
  }

  async remove(fileKey: string): Promise<{ removed: boolean }> {
    const absolutePath = this.resolvePath(fileKey);
    if (!existsSync(absolutePath)) return { removed: false };
    await fs.unlink(absolutePath);
    return { removed: true };
  }

  resolvePath(fileKey: string): string {
    const normalized = fileKey.replace(/\.\./g, '').replace(/^\/+/, '');
    const absolutePath = path.join(this.rootDir, normalized);
    if (!absolutePath.startsWith(this.rootDir)) {
      throw new BadRequestException({ code: 'INVALID_FILE_KEY', message: 'Invalid file key.' });
    }
    return absolutePath;
  }

  getMetadata(fileKey: string): { absolutePath: string; size: number } {
    const absolutePath = this.resolvePath(fileKey);
    if (!existsSync(absolutePath)) {
      throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'The requested file does not exist.' });
    }
    return { absolutePath, size: statSync(absolutePath).size };
  }

  createReadStream(fileKey: string): Readable {
    const { absolutePath } = this.getMetadata(fileKey);
    return createReadStream(absolutePath);
  }
}
