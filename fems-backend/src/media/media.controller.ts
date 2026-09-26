import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { MediaOwnerType } from '@prisma/client';
import { Public } from '../common/decorators';
import { MediaService } from './media.service';
import { MediaQueryDto } from './dto/media.dto';

/**
 * Public imagery for the visitor landing page and record cards.
 *
 * Media lives in the database (`media_assets`) and is seeded from the
 * repository's seed assets, so the catalogue is genuinely data-driven. Reads are
 * public because the imagery is exactly what a signed-out visitor is allowed to
 * browse; writes (uploads) are not exposed here — evidence and documents use the
 * permissioned `/files` endpoints instead.
 */
@ApiTags('media')
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'List public media descriptors (no bytes)' })
  list(@Query() query: MediaQueryDto) {
    return this.media.list({
      ownerType: query.ownerType,
      ownerId: query.ownerId,
      ownerIds: query.ownerIds ? query.ownerIds.split(',').map((value) => value.trim()).filter(Boolean) : undefined,
      role: query.role,
      limit: query.limit,
    });
  }

  @Public()
  @Get('covers')
  @ApiOperation({ summary: 'One cover descriptor per owner id' })
  covers(@Query() query: MediaQueryDto) {
    const ownerType = query.ownerType ?? MediaOwnerType.FOREST;
    const ownerIds = (query.ownerIds ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    return this.media.covers(ownerType, ownerIds);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Stream a media asset (binary)' })
  async raw(@Param('id') id: string, @Res() response: Response) {
    const asset = await this.media.getRaw(id);
    response.setHeader('Content-Type', asset.mimeType);
    response.setHeader('Content-Length', asset.sizeBytes);
    response.setHeader('Cache-Control', 'public, max-age=86400');
    if (asset.altText) response.setHeader('X-Alt-Text', encodeURIComponent(asset.altText));
    response.end(asset.data);
  }
}
