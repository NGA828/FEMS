import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'officer@fems.cm' })
  @IsEmail({}, { message: 'A valid email address is required.' })
  email!: string;

  @ApiProperty({ example: 'Passw0rdFEMS' })
  @IsString()
  @MinLength(1, { message: 'Password is required.' })
  @MaxLength(128)
  password!: string;
}

export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh token returned by /auth/login or /auth/refresh' })
  @IsString()
  @MinLength(20)
  refreshToken!: string;
}

export class LogoutDto {
  @ApiProperty({ required: false, description: 'Refresh token to revoke. Omit to revoke all sessions.' })
  @IsString()
  @MinLength(20)
  refreshToken?: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword!: string;
}
