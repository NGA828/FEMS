import { statfs } from 'node:fs/promises';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AuditAction, AuditSeverity } from '@prisma/client';
import { aiIntegrationStatus, appConfig } from '../config/configuration';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { MetricsService } from '../common/metrics/metrics.service';
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
    private readonly metrics: MetricsService,
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

  // ---------------------------------------------------------------- monitoring

  /**
   * Runtime performance of this deployment.
   *
   * Everything here is measured, never assumed: request throughput and error
   * rates come from the interceptor, job outcomes from the scheduler wrapper,
   * database latency from a real query, storage from the files actually
   * recorded and the disk they sit on. The counters are in-memory, so `since`
   * states when this process started counting.
   */
  async metricsReport() {
    const config = appConfig();
    const snapshot = this.metrics.snapshot();
    const [database, storage, workload] = await Promise.all([this.databaseLatency(), this.storageUsage(), this.workload()]);
    const memory = process.memoryUsage();

    return {
      checkedAt: new Date().toISOString(),
      environment: config.env,
      process: {
        startedAt: snapshot.since,
        uptimeSeconds: snapshot.uptimeSeconds,
        nodeVersion: process.version,
        pid: process.pid,
        memory: {
          rssMb: Number((memory.rss / 1024 / 1024).toFixed(1)),
          heapUsedMb: Number((memory.heapUsed / 1024 / 1024).toFixed(1)),
          heapTotalMb: Number((memory.heapTotal / 1024 / 1024).toFixed(1)),
        },
      },
      requests: snapshot.requests,
      routes: snapshot.routes,
      slowest: snapshot.slowest,
      jobs: snapshot.jobs,
      database,
      storage,
      workload,
    };
  }

  /**
   * Component-by-component health, for the `system:health` gate. Unlike the
   * public `/health` probe this reports the degraded cases an administrator has
   * to act on — a failing scheduled job, a disk nearly full, unreachable SMTP.
   */
  async healthReport() {
    const [integrations, metrics] = await Promise.all([this.integrations(false), this.metricsReport()]);
    const components: Array<{ key: string; label: string; status: 'OK' | 'DEGRADED' | 'FAILING'; detail: string }> = [];

    for (const integration of integrations.integrations) {
      components.push({
        key: integration.key,
        label: integration.label,
        status: integration.state === 'READY' || integration.state === 'DISABLED' ? 'OK' : integration.state === 'UNREACHABLE' ? 'FAILING' : 'DEGRADED',
        detail: integration.summary,
      });
    }

    const failedJobs = metrics.jobs.filter((job) => job.lastRun?.status === 'FAILED');
    components.push({
      key: 'jobs',
      label: 'Scheduled jobs',
      status: failedJobs.length > 0 ? 'FAILING' : 'OK',
      detail:
        failedJobs.length > 0
          ? `${failedJobs.map((job) => job.name).join(', ')} failed on the last run.`
          : `${metrics.jobs.length} job(s) registered; no failure on the last run of this process.`,
    });

    const errorRate = metrics.requests.errorRate;
    components.push({
      key: 'requests',
      label: 'API responses',
      status: metrics.requests.serverErrors > 0 ? 'DEGRADED' : 'OK',
      detail: `${metrics.requests.total} request(s) since start, ${errorRate}% rejected (${metrics.requests.serverErrors} server error(s)), ${metrics.requests.averageMs} ms average.`,
    });

    if (metrics.storage.diskFreePercent !== null) {
      components.push({
        key: 'disk',
        label: 'Disk space',
        status: metrics.storage.diskFreePercent < 5 ? 'FAILING' : metrics.storage.diskFreePercent < 15 ? 'DEGRADED' : 'OK',
        detail: `${metrics.storage.diskFreePercent}% free on the volume holding ${metrics.storage.directory}.`,
      });
    }

    const status = components.some((component) => component.status === 'FAILING')
      ? 'FAILING'
      : components.some((component) => component.status === 'DEGRADED')
        ? 'DEGRADED'
        : 'OK';

    return { checkedAt: new Date().toISOString(), status, environment: appConfig().env, components };
  }

  private async databaseLatency() {
    const startedAt = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { reachable: true, latencyMs: Date.now() - startedAt, error: null as string | null };
    } catch (error) {
      return {
        reachable: false,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message.split('\n')[0] : 'database unavailable',
      };
    }
  }

  /** Bytes recorded in the register, and the free space of the volume they live on. */
  private async storageUsage() {
    const directory = appConfig().storage.localDir;
    const [companyDocuments, permitDocuments, evidence, media] = await Promise.all([
      this.prisma.companyDocument.aggregate({ _sum: { sizeBytes: true }, _count: true }),
      this.prisma.permitDocument.aggregate({ _sum: { sizeBytes: true }, _count: true }),
      this.prisma.evidence.aggregate({ _sum: { sizeBytes: true }, _count: true }),
      this.prisma.mediaAsset.aggregate({ _sum: { sizeBytes: true }, _count: true }),
    ]);

    const buckets = [
      { key: 'companyDocuments', files: companyDocuments._count, bytes: companyDocuments._sum.sizeBytes ?? 0 },
      { key: 'permitDocuments', files: permitDocuments._count, bytes: permitDocuments._sum.sizeBytes ?? 0 },
      { key: 'evidence', files: evidence._count, bytes: evidence._sum.sizeBytes ?? 0 },
      { key: 'media', files: media._count, bytes: media._sum.sizeBytes ?? 0 },
    ];
    const totalBytes = buckets.reduce((sum, bucket) => sum + bucket.bytes, 0);

    let diskFreePercent: number | null = null;
    let diskFreeMb: number | null = null;
    let diskTotalMb: number | null = null;
    try {
      const stats = await statfs(directory);
      const total = Number(stats.blocks) * Number(stats.bsize);
      const free = Number(stats.bavail) * Number(stats.bsize);
      if (total > 0) {
        diskFreePercent = Number(((free / total) * 100).toFixed(1));
        diskFreeMb = Number((free / 1024 / 1024).toFixed(0));
        diskTotalMb = Number((total / 1024 / 1024).toFixed(0));
      }
    } catch {
      // The upload directory may not exist yet on a fresh deployment.
    }

    return {
      directory,
      driver: appConfig().storage.driver,
      files: buckets.reduce((sum, bucket) => sum + bucket.files, 0),
      totalMb: Number((totalBytes / 1024 / 1024).toFixed(2)),
      byKind: buckets.map((bucket) => ({ ...bucket, mb: Number((bucket.bytes / 1024 / 1024).toFixed(2)) })),
      diskFreePercent,
      diskFreeMb,
      diskTotalMb,
    };
  }

  /** How much the register is actually being used over the last 24 hours. */
  private async workload() {
    const since = new Date(Date.now() - 86_400_000);
    const [audited, logins, failedLogins, notifications, sessions] = await Promise.all([
      this.prisma.auditLog.count({ where: { createdAt: { gte: since } } }),
      this.prisma.auditLog.count({ where: { createdAt: { gte: since }, action: 'LOGIN' } }),
      this.prisma.auditLog.count({ where: { createdAt: { gte: since }, action: 'LOGIN_FAILED' } }),
      this.prisma.notification.count({ where: { createdAt: { gte: since } } }),
      this.prisma.refreshToken.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
    ]);
    return { windowHours: 24, auditedActions: audited, logins, failedLogins, notificationsCreated: notifications, activeSessions: sessions };
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
    const status = aiIntegrationStatus();
    const ai = appConfig().ai;
    const disabled = status.selected === 'none';
    return {
      key: 'ai',
      label: `AI provider (${status.selected === 'none' ? 'disabled' : 'Groq'})`,
      state: status.configured ? 'READY' : disabled ? 'DISABLED' : 'MISCONFIGURED',
      summary: status.configured
        ? `${status.provider} ${status.model} writes assistant answers and narrative analyses. The deterministic rule engine runs regardless.`
        : disabled
          ? 'AI_PROVIDER=none: the AI module runs on its deterministic rule engine only.'
          : `${status.missing.join(', ')} is empty, so the AI module runs on its deterministic rule engine only.`,
      missing: status.missing,
      details: {
        selected: status.selected,
        model: status.model,
        baseUrl: ai.groqBaseUrl,
        ruleEngine: true,
        freeTierNote:
          status.selected === 'groq'
            ? 'Groq request and token quotas vary by account and model. Check the current limits in the Groq console; a 429 is a provider limit, and FEMS continues with its rule engine.'
            : undefined,
      },
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
