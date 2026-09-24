import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReportFormat, ReportStatus, ReportType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class ReportQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ReportType })
  @IsOptional()
  @IsEnum(ReportType)
  type?: ReportType;

  @ApiPropertyOptional({ enum: ReportFormat })
  @IsOptional()
  @IsEnum(ReportFormat)
  format?: ReportFormat;

  @ApiPropertyOptional({ enum: ReportStatus })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  forestId?: string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class CreateReportDto {
  @ApiProperty({ enum: ReportType, example: ReportType.PERMITS })
  @IsEnum(ReportType)
  type!: ReportType;

  @ApiPropertyOptional({ enum: ReportFormat, default: ReportFormat.PDF })
  @IsOptional()
  @IsEnum(ReportFormat)
  format?: ReportFormat;

  @ApiPropertyOptional({
    example: 'Permit register — UFA 10-012 — Q3 2026',
    description: 'Optional title; when omitted a title is derived from the type, the filters and the period.',
  })
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(191)
  title?: string;

  @ApiPropertyOptional({ example: '2026-07-01', description: 'Start of the reporting period' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'End of the reporting period' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Restrict the report to one forest' })
  @IsOptional()
  @IsUUID()
  forestId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  protectedAreaId?: string;

  @ApiPropertyOptional({ description: 'Restrict the report to one company (regulators only)' })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  permitId?: string;

  @ApiPropertyOptional({
    example: 500,
    description: 'Maximum number of rows to include (defaults to the server ceiling)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  maxRows?: number;
}

export class SendReportDto {
  @ApiPropertyOptional({
    description: 'Optional message shown to the recipients in the notification.',
    example: 'The quarterly compliance scorecard is ready for the regional review.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;

  @ApiPropertyOptional({ enum: ['OFFICERS', 'COMPANIES'], default: 'OFFICERS' })
  @IsOptional()
  @IsIn(['OFFICERS', 'COMPANIES'])
  audience?: 'OFFICERS' | 'COMPANIES';
}
