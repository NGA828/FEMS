import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CompanyType } from '@prisma/client';

export class RegisterDto {
  @ApiProperty({ example: 'ngono.marie@example.cm' })
  @IsEmail({}, { message: 'A valid email address is required.' })
  email!: string;

  @ApiProperty({ example: 'Passw0rdFEMS', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiProperty({ example: 'Marie' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ example: 'Ngono' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  lastName!: string;

  @ApiPropertyOptional({ example: '+237653123456' })
  @IsOptional()
  @Matches(/^\+?[0-9\s-]{8,20}$/, { message: 'Phone number format is invalid.' })
  phone?: string;

  @ApiPropertyOptional({
    enum: ['FOREST_EXPLORER', 'COMPANY_REPRESENTATIVE'],
    default: 'FOREST_EXPLORER',
    description:
      'Self-service roles only. Regulator, inspector, field operator and administrator accounts are created by an administrator.',
  })
  @IsOptional()
  @IsEnum({ FOREST_EXPLORER: 'FOREST_EXPLORER', COMPANY_REPRESENTATIVE: 'COMPANY_REPRESENTATIVE' })
  requestedRole?: 'FOREST_EXPLORER' | 'COMPANY_REPRESENTATIVE';

  // --- company details (only for COMPANY_REPRESENTATIVE registrations) -----
  @ApiPropertyOptional({ example: 'Société Forestière du Sud SARL' })
  @ValidateIf((dto: RegisterDto) => dto.requestedRole === 'COMPANY_REPRESENTATIVE')
  @IsString()
  @MinLength(3)
  @MaxLength(191)
  companyName?: string;

  @ApiPropertyOptional({ example: 'RC/DLA/2019/B/1234' })
  @ValidateIf((dto: RegisterDto) => dto.requestedRole === 'COMPANY_REPRESENTATIVE')
  @IsString()
  @MaxLength(64)
  companyRegistrationNumber?: string;

  @ApiPropertyOptional({ enum: CompanyType, example: CompanyType.LOGGING_COMPANY })
  @IsOptional()
  @IsEnum(CompanyType)
  companyType?: CompanyType;

  @ApiPropertyOptional({ example: 'Yaoundé' })
  @ValidateIf((dto: RegisterDto) => dto.requestedRole === 'COMPANY_REPRESENTATIVE')
  @IsString()
  @MaxLength(96)
  companyCity?: string;

  @ApiPropertyOptional({ example: 'Centre' })
  @ValidateIf((dto: RegisterDto) => dto.requestedRole === 'COMPANY_REPRESENTATIVE')
  @IsString()
  @MaxLength(96)
  companyRegion?: string;

  @ApiPropertyOptional({ example: 'Rue 1.234, Bastos' })
  @ValidateIf((dto: RegisterDto) => dto.requestedRole === 'COMPANY_REPRESENTATIVE')
  @IsString()
  @MaxLength(255)
  companyAddress?: string;

  @ApiPropertyOptional({ example: '+237222314455' })
  @IsOptional()
  @Matches(/^\+?[0-9\s-]{8,20}$/)
  companyPhone?: string;

  @ApiPropertyOptional({ example: 'fr', enum: ['fr', 'en'] })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  preferredLanguage?: string;
}

export class ResendVerificationDto {
  @ApiProperty({ example: 'ngono.marie@example.cm' })
  @IsEmail()
  email!: string;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'Token received by email (or returned in development mode)' })
  @IsString()
  @MinLength(20)
  token!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'ngono.marie@example.cm' })
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  token!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}
