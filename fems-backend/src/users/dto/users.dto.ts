import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class CreateUserDto {
  @ApiProperty({ example: 'officer@fems.cm' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Awa' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ example: 'Mballa' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  lastName!: string;

  @ApiPropertyOptional({ example: '+237677112233' })
  @IsOptional()
  @Matches(/^\+?[0-9\s-]{8,20}$/)
  phone?: string;

  @ApiPropertyOptional({ example: 'Chef de poste forestier' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string;

  @ApiProperty({
    enum: [
      'VISITOR',
      'FOREST_EXPLORER',
      'COMPANY_REPRESENTATIVE',
      'GOVERNMENT_FOREST_OFFICER',
      'ENVIRONMENTAL_OFFICER',
      'FOREST_INSPECTOR',
      'FIELD_OPERATOR',
      'ADMINISTRATOR',
    ],
    example: 'FOREST_INSPECTOR',
  })
  @IsString()
  role!: string;

  @ApiPropertyOptional({ description: 'Company id — required for company representatives and field operators' })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional({
    description:
      'Optional initial password. When omitted the API generates a strong temporary password and returns it once.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @ApiPropertyOptional({ default: false, description: 'Mark demo accounts clearly in the UI' })
  @IsOptional()
  @IsBoolean()
  isDemo?: boolean;
}

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

export class UpdateUserStatusDto {
  @ApiProperty({ enum: UserStatus, example: UserStatus.SUSPENDED })
  @IsEnum(UserStatus)
  status!: UserStatus;

  @ApiPropertyOptional({ example: 'Repeated falsified inspection reports' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AssignRoleDto {
  @ApiProperty({ example: 'FOREST_INSPECTOR' })
  @IsString()
  role!: string;

  @ApiPropertyOptional({ description: 'Optional expiry (ISO date) for temporary assignments' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class AdminResetPasswordDto {
  @ApiPropertyOptional({ description: 'When omitted a strong temporary password is generated' })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword?: string;

  @ApiPropertyOptional({ default: true, description: 'Revoke every active session of the user' })
  @IsOptional()
  @IsBoolean()
  revokeSessions?: boolean;
}

export class UsersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: UserStatus })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @ApiPropertyOptional({ description: 'Role name filter, e.g. GOVERNMENT_FOREST_OFFICER' })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional({ description: 'Include soft-deleted accounts' })
  @IsOptional()
  @IsBoolean()
  includeDeleted?: boolean;
}
