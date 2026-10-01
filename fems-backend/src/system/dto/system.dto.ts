import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional } from 'class-validator';

export class IntegrationQueryDto {
  @ApiPropertyOptional({
    default: true,
    description: 'Perform the live probes (SMTP handshake). Set to false for an instant, configuration-only answer.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? !['false', '0', 'no'].includes(value.toLowerCase()) : value))
  @IsBoolean()
  probe?: boolean;
}

export class SendTestEmailDto {
  @ApiPropertyOptional({
    example: 'minister.office@fems.cm',
    description: 'Where to send the test. Defaults to the email address of the administrator making the request.',
  })
  @IsOptional()
  @IsEmail({}, { message: 'Provide a valid email address.' })
  to?: string;
}
