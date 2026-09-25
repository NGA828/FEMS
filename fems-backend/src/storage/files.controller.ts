import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuditAction, AuditSeverity } from '@prisma/client';
import { StorageService } from './storage.service';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, RequirePermissions, type AuthenticatedUser } from '../common/decorators';

const ALLOWED_FOLDERS = [
  'attachments',
  'permits/documents',
  'companies/documents',
  'inspections/evidence',
  'activities/photos',
  'observations/photos',
  'violations/evidence',
  'reports/exports',
  'users/avatars',
];

@ApiTags('files')
@ApiBearerAuth('bearer')
@Controller('files')
export class FilesController {
  constructor(
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  @Post('upload')
  @RequirePermissions('files:upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiQuery({
    name: 'folder',
    required: false,
    enum: ALLOWED_FOLDERS,
    description: 'Logical destination folder (evidence, documents, exports…)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOperation({
    summary: 'Upload a file and receive its storage key',
    description:
      'Multipart upload (field name `file`). The returned `fileKey`/`fileUrl`/`checksum` are attached to the domain record (evidence, permit or company document, report export). Files are validated by MIME type and size, stored under an unguessable key and hashed with SHA-256.',
  })
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
    @Query('folder') folder = 'attachments',
  ) {
    if (!file) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'A file is required in the multipart field named "file".',
      });
    }
    const normalized = folder.replace(/^\/+|\/+$/g, '');
    if (!ALLOWED_FOLDERS.includes(normalized)) {
      throw new BadRequestException({
        code: 'INVALID_FOLDER',
        message: `folder must be one of: ${ALLOWED_FOLDERS.join(', ')}.`,
      });
    }

    const stored = await this.storage.save({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      folder: normalized,
    });

    await this.audit.record({
      action: AuditAction.FILE_UPLOAD,
      severity: AuditSeverity.INFO,
      entityType: 'File',
      entityId: stored.fileKey,
      actorId: user.id,
      actorEmail: user.email,
      description: `Uploaded ${stored.mimeType} (${stored.sizeBytes} bytes) to ${normalized}`,
    });

    return stored;
  }

  @Get('download')
  @RequirePermissions('files:read')
  @ApiQuery({ name: 'key', required: true, example: 'inspections/evidence/2026-09-24/uuid.jpg' })
  @ApiOperation({ summary: 'Download a stored file by key' })
  download(@Query('key') key: string, @Res() response: Response) {
    if (!key) {
      throw new BadRequestException({ code: 'FILE_KEY_REQUIRED', message: 'The file key is required.' });
    }
    const metadata = this.storage.getMetadata(key);
    response.setHeader('Content-Length', metadata.size);
    response.setHeader('Cache-Control', 'private, max-age=3600');
    this.storage.createReadStream(key).pipe(response);
  }
}
