import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { NotificationChannel, NotificationType } from '@prisma/client';

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\+?[0-9\s-]{8,20}$/)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  jobTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(512)
  avatarUrl?: string;

  @ApiPropertyOptional({ enum: ['fr', 'en'] })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  preferredLanguage?: string;
}

export class RegisterDeviceTokenDto {
  @ApiProperty({ description: 'Expo push token (ExponentPushToken[...]) or FCM/APNs token' })
  @IsString()
  @MinLength(10)
  @MaxLength(191)
  token!: string;

  @ApiProperty({ enum: ['ios', 'android', 'web'] })
  @IsEnum({ ios: 'ios', android: 'android', web: 'web' })
  platform!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(191)
  deviceName?: string;
}

export class UpdateNotificationPreferenceDto {
  @ApiProperty({ enum: NotificationType })
  @IsEnum(NotificationType)
  type!: NotificationType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  inAppEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;
}

export class NotificationChannelDto {
  @ApiProperty({ enum: NotificationChannel })
  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}
