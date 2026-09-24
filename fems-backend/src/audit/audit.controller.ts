import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuditAction, AuditSeverity } from '@prisma/client';
import { AuditService } from './audit.service';
import { RequirePermissions } from '../common/decorators';
import { PaginationQueryDto, paginate } from '../common/dto/pagination.dto';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

class AuditQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AuditAction })
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @ApiPropertyOptional({ enum: AuditSeverity })
  @IsOptional()
  @IsEnum(AuditSeverity)
  severity?: AuditSeverity;

  @ApiPropertyOptional({ description: 'Entity type, e.g. ExploitationPermit' })
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiPropertyOptional({ description: 'ISO date — inclusive lower bound' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO date — inclusive upper bound' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

@ApiTags('audit')
@ApiBearerAuth('bearer')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit:read')
  @ApiOperation({
    summary: 'List audit-trail entries',
    description: 'Requires `audit:read` (administrators and government officers).',
  })
  async list(@Query() query: AuditQueryDto) {
    const result = await this.audit.list({
      action: query.action,
      severity: query.severity,
      entityType: query.entityType,
      entityId: query.entityId,
      actorId: query.actorId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
    return paginate(result.items, result.meta.total, query.page, query.limit);
  }

  @Get('summary')
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Audit activity summary for the monitoring dashboard' })
  @ApiQuery({ name: 'days', required: false, example: 7 })
  async summary(@Query('days') days?: string) {
    return this.audit.summary(days ? Number(days) : 7);
  }
}
