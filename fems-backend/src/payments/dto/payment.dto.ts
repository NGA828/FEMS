import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentMethod, PaymentPurpose, PaymentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class PaymentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional({ enum: PaymentPurpose })
  @IsOptional()
  @IsEnum(PaymentPurpose)
  purpose?: PaymentPurpose;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  permitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class InitiatePaymentDto {
  @ApiProperty({ enum: PaymentPurpose, example: PaymentPurpose.PERMIT_FEE })
  @IsEnum(PaymentPurpose)
  purpose!: PaymentPurpose;

  @ApiProperty({ example: 300000, description: 'Amount in XAF' })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500000000)
  amount!: number;

  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.MOBILE_MONEY_MTN })
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @ApiPropertyOptional({ description: 'Permit the payment settles' })
  @IsOptional()
  @IsUUID()
  permitId?: string;

  @ApiPropertyOptional({ description: 'Violation fine being settled' })
  @IsOptional()
  @IsUUID()
  violationId?: string;

  @ApiPropertyOptional({ example: '+237699112233', description: 'Mobile money number to debit' })
  @IsOptional()
  @Matches(/^\+?[0-9\s-]{8,20}$/, { message: 'payerPhone must be a valid phone number' })
  payerPhone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({
    description: 'Client-side idempotency key so a retried request does not create a second payment',
    example: 'pay-offline-4c81',
  })
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  clientRef?: string;
}

export class VerifyPaymentDto {
  @ApiPropertyOptional({ description: 'Optional note recorded with the verification' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/** Sandbox confirmation — only accepted while PAYMENT_PROVIDER=simulator. */
export class SimulatePaymentDto {
  @ApiProperty({ enum: ['SUCCESSFUL', 'FAILED', 'CANCELLED'], example: 'SUCCESSFUL' })
  @IsIn(['SUCCESSFUL', 'FAILED', 'CANCELLED'])
  outcome!: 'SUCCESSFUL' | 'FAILED' | 'CANCELLED';

  @ApiPropertyOptional({ example: 'Customer approved the sandbox prompt' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CampayWebhookDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(96)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(48)
  external_reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({ description: 'Provider-specific payload fields are stored verbatim for the audit trail' })
  @IsOptional()
  extra?: Record<string, unknown>;
}
