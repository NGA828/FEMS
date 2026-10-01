import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { SystemService } from './system.service';
import { IntegrationQueryDto, SendTestEmailDto } from './dto/system.dto';
import { appConfig } from '../config/configuration';
import { CurrentUser, RequireAnyPermission, RequirePermissions, type AuthenticatedUser } from '../common/decorators';

/**
 * System configuration and integration monitoring.
 *
 * These routes answer "is this deployment actually able to send an email,
 * take a payment, call the AI provider?" — the information an administrator
 * needs before telling a user that a verification code is on its way.
 */
@ApiTags('settings')
@ApiBearerAuth('bearer')
@Controller('system')
export class SystemController {
  constructor(private readonly system: SystemService) {}

  @Get('integrations')
  @RequireAnyPermission('settings:read', 'settings:manage')
  @ApiOperation({
    summary: 'State of every external integration',
    description:
      'Reports email (SMTP), push, payments, the AI provider, file storage and the database. SMTP is verified with a real handshake unless `probe=false`.',
  })
  integrations(@Query() query: IntegrationQueryDto) {
    return this.system.integrations(query.probe ?? true);
  }

  @Get('integrations/mail')
  @RequireAnyPermission('settings:read', 'settings:manage')
  @ApiOperation({
    summary: 'Email transport status',
    description: 'The SMTP configuration (never the password) and whether the server accepts the credentials right now.',
  })
  mail(@Query() query: IntegrationQueryDto) {
    return this.system.mailStatus(query.probe ?? true);
  }

  @Post('integrations/mail/test')
  @RequirePermissions('settings:manage')
  @Throttle({ default: { limit: appConfig().security.authStrictThrottleLimit, ttl: appConfig().security.throttleTtlSeconds * 1000 } })
  @ApiOperation({
    summary: 'Send a test email through the configured transport',
    description:
      'Delivers a real message using the same transport as verification codes and notifications. The SMTP response is returned verbatim — a failure is never reported as a success. Recorded in the audit trail.',
  })
  sendTestEmail(@CurrentUser() user: AuthenticatedUser, @Body() dto: SendTestEmailDto, @Req() request: Request) {
    return this.system.sendTestEmail(user, dto.to, {
      ipAddress: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
    });
  }
}
