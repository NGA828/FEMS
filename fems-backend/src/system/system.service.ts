import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AuditAction, AuditSeverity } from '@prisma/client';
import { appConfig } from '../config/configuration';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../common/decorators';

export type IntegrationState = 'READY' | 'DISABLED' | 'MISCONFIGURED' | 'UNREACHABLE';

export interface IntegrationReport {
  key: string;
  label: string;
  state: IntegrationState;
  summary: string;
  /** Environment variables the operator still has to provide. */
  missing: string[];
  details: Record<string, unknown>;
}

/**
 * Integration status.
 *
 * Administrators need an honest answer to "does email actually work on this
 * deployment?" — not a green dot derived from the fact that a variable exists.
 * Each integration reports whether it is enabled, whether its configuration is
 * complete, and (for SMTP) whether the server really answers a handshake.
 */
@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name);

  constructor(
    private readonly mail: MailService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Full integration report. `probe=false` skips the network round-trips
   * (SMTP handshake) so the screen can render instantly and verify on demand.
   */
  async integrations(probe = true): Promise<{ checkedAt: string; environment: string; integrations: IntegrationReport[] }> {
    const config = appConfig();
    const [mail, database] = await Promise.all([this.mailIntegration(probe), this.databaseIntegration()]);

    return {
      checkedAt: new Date().toISOString(),
      environment: config.env,
      integrations: [mail, this.pushIntegration(), this.paymentsIntegration(), this.aiIntegration(), this.storageIntegration(), database],
    };
  }

  /** SMTP only — used by the Settings screen's "verify" button. */
  async mailStatus(probe = true): Promise<IntegrationReport> {
    return this.mailIntegration(probe);
  }

  /**
   * Sends a real email through the configured transport. The result is never
   * optimistic: a transport error is returned verbatim so the administrator can
   * fix the credentials instead of guessing.
   */
  async sendTestEmail(
    user: AuthenticatedUser,
    to: string | undefined,
    context: { ipAddress?: string | null; userAgent?: string | null } = {},
  ) {
    const recipient = (to ?? user.email ?? '').trim();
    if (!recipient) {
      throw new BadRequestException({
        code: 'RECIPIENT_REQUIRED',
        message: 'No recipient address was supplied and the account has no email address.',
      });
    }

    const transport = this.mail.describe();
    if (!transport.configured) {
      throw new BadRequestException({
        code: 'MAIL_NOT_CONFIGURED',
        message: `Email delivery is not configured on this server (missing: ${transport.missing.join(', ')}). Set those variables in fems-backend/.env and restart the API.`,
        missing: transport.missing,
      });
    }

    const result = await this.mail.sendTestEmail(recipient, `${user.firstName} ${user.lastName} <${user.email}>`);

    await this.audit.record({
      action: AuditAction.SETTINGS_CHANGE,
      entityType: 'MailTransport',
      entityId: transport.host ?? 'smtp',
      description: `Email delivery test to ${recipient}: ${result.status}${result.error ? ` — ${result.error}` : ''}`,
      severity: result.status === 'SENT' ? AuditSeverity.INFO : AuditSeverity.WARNING,
      actorId: user.id,
      actorEmail: user.email,
      after: { recipient, status: result.status, messageId: result.messageId ?? null },
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
    });

    return {
      recipient,
      status: result.status,
      messageId: result.messageId ?? null,
      error: result.error ?? null,
      transport: { host: transport.host, port: transport.port, from: transport.from, secure: transport.secure },
      message:
        result.status === 'SENT'
          ? `Test email accepted by ${transport.host} for ${recipient}. Check the inbox (and the spam folder).`
          : `The SMTP server refused the message: ${result.error ?? 'unknown error'}`,
    };
  }

  // ------------------------------------------------------------- integrations

  private async mailIntegration(probe: boolean): Promise<IntegrationReport> {
    const transport = this.mail.describe();
    const details: Record<string, unknown> = {
      host: transport.host,
      port: transport.port,
      secure: transport.secure,
      username: transport.username,
      passwordSet: transport.passwordSet,
      from: transport.from,
      canSendTest: transport.configured,
    };

    if (!transport.configured) {
      const disabled = transport.provider === 'none' && !transport.host;
      return {
        key: 'mail',
        label: 'Transactional email (SMTP)',
        state: disabled ? 'DISABLED' : 'MISCONFIGURED',
        summary: disabled
          ? 'Email is switched off. Verification codes and password-reset codes are returned in the API response outside production, and no notification email is sent.'
          : `SMTP is incomplete — set ${transport.missing.join(', ')} in fems-backend/.env.`,
        missing: transport.missing,
        details,
      };
    }

    if (!probe) {
      return {
        key: 'mail',
        label: 'Transactional email (SMTP)',
        state: 'READY',
        summary: `Configured for ${transport.host}:${transport.port}. Not verified in this response — run a verification to test the handshake.`,
        missing: [],
        details: { ...details, verified: false },
      };
    }

    const verification = await this.mail.verifyConnection();
    return {
      key: 'mail',
      label: 'Transactional email (SMTP)',
      state: verification.reachable ? 'READY' : 'UNREACHABLE',
      summary: verification.reachable
        ? `${transport.host}:${transport.port} accepted the credentials. Email is delivered from ${transport.from}.`
        : `${transport.host}:${transport.port} refused the connection: ${verification.error ?? 'unknown error'}`,
      missing: [],
      details: { ...details, verified: true, reachable: verification.reachable, error: verification.error ?? null },
    };
  }

  private pushIntegration(): IntegrationReport {
    const { pushProvider, expoPushUrl } = appConfig().notifications;
    const enabled = pushProvider === 'expo';
    return {
      key: 'push',
      label: 'Push notifications',
      state: enabled ? 'READY' : 'DISABLED',
      summary: enabled
        ? `Delivered through the Expo push service (${expoPushUrl}) to the device tokens registered on each account.`
        : 'Push delivery is switched off (PUSH_PROVIDER=none). Notifications are still stored in-app.',
      missing: enabled ? [] : ['PUSH_PROVIDER'],
      details: { provider: pushProvider, endpoint: expoPushUrl },
    };
  }

  private paymentsIntegration(): IntegrationReport {
    const { provider, campay } = appConfig().payments;
    if (provider !== 'campay') {
      return {
        key: 'payments',
        label: 'Payments',
        state: 'DISABLED',
        summary: 'The payment simulator is active: transactions are settled locally and never leave the server. Set PAYMENT_PROVIDER=campay for real mobile money.',
        missing: [],
        details: { provider: 'simulator', currency: campay.currency },
      };
    }
    const missing = [
      ...(campay.apiKey ? [] : ['CAMPAY_API_KEY']),
      ...(campay.username ? [] : ['CAMPAY_USERNAME']),
      ...(campay.password ? [] : ['CAMPAY_PASSWORD']),
    ];
    return {
      key: 'payments',
      label: 'Payments (Campay mobile money)',
      state: missing.length === 0 ? 'READY' : 'MISCONFIGURED',
      summary:
        missing.length === 0
          ? `Campay is configured against ${campay.baseUrl} in ${campay.currency}.`
          : `Campay is selected but incomplete — set ${missing.join(', ')}. Payments are rejected rather than simulated.`,
      missing,
      details: { provider: 'campay', baseUrl: campay.baseUrl, currency: campay.currency, webhookConfigured: Boolean(campay.webhookSecret) },
    };
  }

  private aiIntegration(): IntegrationReport {
    const { geminiApiKey, geminiModel } = appConfig().ai;
    return {
      key: 'ai',
      label: 'AI provider (Gemini)',
      state: geminiApiKey ? 'READY' : 'DISABLED',
      summary: geminiApiKey
        ? `Gemini ${geminiModel} answers assistant questions and narrative analyses. Deterministic rules run regardless.`
        : 'No Gemini key: the AI module runs on its deterministic rule engine only.',
      missing: geminiApiKey ? [] : ['GEMINI_API_KEY'],
      details: { model: geminiModel, ruleEngine: true },
    };
  }

  private storageIntegration(): IntegrationReport {
    const { driver, localDir, maxUploadSizeMb } = appConfig().storage;
    const s3Selected = driver === 's3';
    return {
      key: 'storage',
      label: 'File storage',
      state: s3Selected ? 'MISCONFIGURED' : 'READY',
      summary: s3Selected
        ? 'STORAGE_DRIVER=s3 is selected but object storage is not implemented in this build — files would still be written to the local disk. Use STORAGE_DRIVER=local.'
        : `Files are written to ${localDir} (max ${maxUploadSizeMb} MB per upload).`,
      missing: [],
      details: { driver, localDir, maxUploadSizeMb },
    };
  }

  private async databaseIntegration(): Promise<IntegrationReport> {
    const startedAt = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        key: 'database',
        label: 'Database (MySQL)',
        state: 'READY',
        summary: `The database answered in ${Date.now() - startedAt} ms.`,
        missing: [],
        details: { latencyMs: Date.now() - startedAt },
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message.split('\n')[0] : 'database unavailable';
      this.logger.error(`Database probe failed: ${reason}`);
      return {
        key: 'database',
        label: 'Database (MySQL)',
        state: 'UNREACHABLE',
        summary: reason,
        missing: [],
        details: { latencyMs: Date.now() - startedAt, error: reason },
      };
    }
  }
}
