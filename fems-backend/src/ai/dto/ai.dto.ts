import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AiAnalysisStatus, AiAnalysisType, AiProvider, AlertStatus, AlertType, RiskLevel } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
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
import { ALERT_ACTIONS, type AlertAction } from '../alert-state';

export class RunAnalysisDto {
  @ApiProperty({ enum: AiAnalysisType, example: AiAnalysisType.RISK_ASSESSMENT })
  @IsEnum(AiAnalysisType)
  type!: AiAnalysisType;

  @ApiPropertyOptional({ description: 'Limit the run to one forest' })
  @IsOptional()
  @IsUUID()
  forestId?: string;

  @ApiPropertyOptional({ description: 'Limit the run to one forest zone' })
  @IsOptional()
  @IsUUID()
  zoneId?: string;

  @ApiPropertyOptional({ description: 'Regulators may target one company; a company account is always pinned to its own.' })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  permitId?: string;

  @ApiPropertyOptional({ default: 90, minimum: 7, maximum: 365, description: 'How far back the records are read.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(365)
  periodDays?: number;

  @ApiPropertyOptional({
    default: true,
    description:
      'When false, the run never calls Gemini: the deterministic rule engine produces the findings and the narrative.',
  })
  @IsOptional()
  @IsBoolean()
  useProvider?: boolean;
}

/**
 * @responseOnly
 * Shape of an analysis returned by the API (kept for the OpenAPI schema only).
 */
export class AnalysisResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: AiAnalysisType }) type!: AiAnalysisType;
  @ApiProperty({ enum: AiAnalysisStatus }) status!: AiAnalysisStatus;
  @ApiProperty({ enum: AiProvider }) provider!: AiProvider;
  @ApiProperty({ enum: RiskLevel, required: false }) riskLevel?: RiskLevel;
  @ApiProperty({ required: false }) summary?: string;
}

export class AnalysisQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AiAnalysisType })
  @IsOptional()
  @IsEnum(AiAnalysisType)
  type?: AiAnalysisType;

  @ApiPropertyOptional({ enum: AiAnalysisStatus })
  @IsOptional()
  @IsEnum(AiAnalysisStatus)
  status?: AiAnalysisStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  forestId?: string;

  @ApiPropertyOptional({ description: 'Only an administrator may read analyses run by other accounts.' })
  @IsOptional()
  @IsUUID()
  requestedById?: string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsString()
  to?: string;
}

export class AlertQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: AlertStatus })
  @IsOptional()
  @IsEnum(AlertStatus)
  status?: AlertStatus;

  @ApiPropertyOptional({ enum: AlertType })
  @IsOptional()
  @IsEnum(AlertType)
  type?: AlertType;

  @ApiPropertyOptional({ enum: RiskLevel })
  @IsOptional()
  @IsEnum(RiskLevel)
  riskLevel?: RiskLevel;

  @ApiPropertyOptional({ enum: AiProvider })
  @IsOptional()
  @IsEnum(AiProvider)
  detector?: AiProvider;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  forestId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  permitId?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'], description: 'Only alerts still waiting for their first review.' })
  @IsOptional()
  @IsIn(['true', 'false'])
  awaitingReview?: 'true' | 'false';

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsString()
  to?: string;
}

export class ReviewAlertDto {
  @ApiProperty({ enum: ALERT_ACTIONS, example: 'CONFIRM' })
  @IsIn(ALERT_ACTIONS)
  action!: AlertAction;

  @ApiPropertyOptional({ minLength: 10, maxLength: 1000, description: 'Mandatory for CONFIRM, DISMISS, RESOLVE and REOPEN.' })
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason?: string;

  @ApiPropertyOptional({ minLength: 10, maxLength: 1000, description: 'The documented evidence that supports a confirmation.' })
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  evidenceNote?: string;

  @ApiPropertyOptional({ minLength: 10, maxLength: 500, description: 'What was actually done — mandatory to resolve.' })
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  resolutionAction?: string;

  @ApiPropertyOptional({ description: 'Link a confirmed alert to an existing environmental case.' })
  @IsOptional()
  @IsUUID()
  violationId?: string;

  @ApiPropertyOptional({ default: false, description: 'Ask the inspection services to verify the site in the field.' })
  @IsOptional()
  @IsBoolean()
  requestInspection?: boolean;
}

export class AskAssistantDto {
  @ApiPropertyOptional({ description: 'Continue an existing conversation owned by the caller.' })
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @ApiProperty({ minLength: 3, maxLength: 800, example: 'Quels permis sont actifs dans la région du Centre ?' })
  @IsString()
  @MinLength(3)
  @MaxLength(800)
  question!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  forestId?: string;

  @ApiPropertyOptional({ description: 'Ignored for company accounts, which are always scoped to their own company.' })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  permitId?: string;

  @ApiPropertyOptional({
    default: true,
    description: 'When false, a provider failure is returned as an error instead of a rule-engine answer.',
  })
  @IsOptional()
  @IsBoolean()
  fallbackToRules?: boolean;
}

export class ConversationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  includeArchived?: 'true' | 'false';
}
