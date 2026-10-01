import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { appConfig } from '../config/configuration';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

export interface MailResult {
  /** `SENT` only when the SMTP server accepted the message. */
  status: 'SENT' | 'NOT_CONFIGURED' | 'FAILED';
  messageId?: string;
  error?: string;
}

/**
 * Transactional email.
 *
 * FEMS ships a complete SMTP integration (nodemailer) configured exclusively
 * from environment variables. If SMTP is not configured the service never
 * pretends a message was delivered: it reports `NOT_CONFIGURED` (with the
 * failing environment variables listed) or `FAILED` with the transport error,
 * and logs the reason. Callers decide how to surface that to the client.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  get isConfigured(): boolean {
    return this.missingConfiguration().length === 0;
  }

  /** Lists the environment variables that must be provided to enable email. */
  missingConfiguration(): string[] {
    const { smtp, emailProvider } = appConfig().notifications;
    const missing: string[] = [];
    if (emailProvider === 'none') missing.push('EMAIL_PROVIDER');
    if (!smtp.host) missing.push('SMTP_HOST');
    if (!smtp.port) missing.push('SMTP_PORT');
    if (!smtp.from) missing.push('SMTP_FROM');
    if (smtp.user && !smtp.password) missing.push('SMTP_PASSWORD');
    return missing;
  }

  /**
   * Non-secret description of the transport, for the administration screens.
   * The password is never returned — only whether one is set.
   */
  describe(): {
    provider: string;
    configured: boolean;
    missing: string[];
    host: string | null;
    port: number | null;
    secure: boolean;
    username: string | null;
    passwordSet: boolean;
    from: string | null;
  } {
    const { smtp, emailProvider } = appConfig().notifications;
    return {
      provider: emailProvider,
      configured: this.isConfigured,
      missing: this.missingConfiguration(),
      host: smtp.host || null,
      port: smtp.host ? smtp.port : null,
      secure: smtp.port === 465,
      username: smtp.user ? this.maskAddress(smtp.user) : null,
      passwordSet: Boolean(smtp.password),
      from: smtp.from || null,
    };
  }

  /** Drops the cached transporter so a configuration change is picked up. */
  resetTransport(): void {
    this.transporter = null;
  }

  private maskAddress(value: string): string {
    const [local, domain] = value.split('@');
    if (!domain) return `${value.slice(0, 2)}***`;
    const head = local.slice(0, Math.min(2, local.length));
    return `${head}${'*'.repeat(Math.max(1, local.length - head.length))}@${domain}`;
  }

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter;
    const { smtp } = appConfig().notifications;
    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    return this.transporter;
  }

  async send(message: MailMessage): Promise<MailResult> {
    if (!this.isConfigured) {
      const missing = this.missingConfiguration();
      this.logger.warn(
        `Email "${message.subject}" to ${message.to} was NOT sent: SMTP is not configured (missing: ${missing.join(', ') || 'SMTP_HOST'}).`,
      );
      return {
        status: 'NOT_CONFIGURED',
        error: `Email delivery is not configured on this server (missing: ${missing.join(', ') || 'SMTP_HOST'}).`,
      };
    }
    try {
      const info = await this.getTransporter().sendMail({
        from: appConfig().notifications.smtp.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        replyTo: message.replyTo,
      });
      this.logger.log(`Email "${message.subject}" sent to ${message.to} (${info.messageId}).`);
      return { status: 'SENT', messageId: info.messageId };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Email "${message.subject}" to ${message.to} failed: ${reason}`);
      return { status: 'FAILED', error: reason };
    }
  }

  /** Verifies SMTP credentials at boot / on demand (surfaced by /system/integrations). */
  async verifyConnection(): Promise<{ configured: boolean; reachable: boolean; error?: string }> {
    if (!this.isConfigured) return { configured: false, reachable: false };
    try {
      await this.getTransporter().verify();
      return { configured: true, reachable: true };
    } catch (error) {
      return {
        configured: true,
        reachable: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // --- branded templates ---------------------------------------------------

  sendEmailVerification(to: string, firstName: string, token: string, expiresAt: Date): Promise<MailResult> {
    const link = `${appConfig().storage.publicUrl || 'fems://'}email-verification?token=${token}`;
    return this.send({
      to,
      subject: 'FEMS — confirm your email address',
      text:
        `Hello ${firstName},\n\n` +
        `Welcome to the Forest Exploitation Management System (FEMS).\n` +
        `Confirm your email address within ${this.hoursUntil(expiresAt)} hours:\n\n${token}\n\n` +
        `Or open: ${link}\n\n` +
        `If you did not create a FEMS account, ignore this message.\n\n— FEMS, Ministère des Forêts et de la Faune (demo deployment)`,
      html: this.wrap(
        `Confirm your email address`,
        `<p>Hello ${this.escape(firstName)},</p>
         <p>Welcome to the <strong>Forest Exploitation Management System (FEMS)</strong>.</p>
         <p>Enter this verification code in the app to activate your account:</p>
         <p style="font-size:22px;letter-spacing:3px;font-weight:700;color:#14532d">${this.escape(token)}</p>
         <p>This code expires in ${this.hoursUntil(expiresAt)} hours.</p>
         <p style="color:#6b7280;font-size:13px">If you did not create a FEMS account, you can safely ignore this email.</p>`,
      ),
    });
  }

  sendPasswordReset(to: string, firstName: string, token: string, expiresAt: Date): Promise<MailResult> {
    const minutes = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60000));
    return this.send({
      to,
      subject: 'FEMS — password reset code',
      text:
        `Hello ${firstName},\n\n` +
        `Use the code below to choose a new password (valid ${minutes} minutes):\n\n${token}\n\n` +
        `If you did not request a password reset, change your password immediately and contact an administrator.\n\n— FEMS`,
      html: this.wrap(
        `Reset your password`,
        `<p>Hello ${this.escape(firstName)},</p>
         <p>Use this code to choose a new FEMS password. It is valid for ${minutes} minutes.</p>
         <p style="font-size:22px;letter-spacing:3px;font-weight:700;color:#14532d">${this.escape(token)}</p>
         <p style="color:#6b7280;font-size:13px">If you did not request this, your account may be at risk — change your password and notify an administrator.</p>`,
      ),
    });
  }

  /**
   * Delivery test used by `POST /system/integrations/mail/test`. It goes
   * through exactly the same transport as a production notification, so a
   * success here proves real deliverability rather than a reachable socket.
   */
  sendTestEmail(to: string, requestedBy: string): Promise<MailResult> {
    const stamp = new Date().toISOString();
    const transport = this.describe();
    return this.send({
      to,
      subject: 'FEMS — email delivery test',
      text:
        `This is a FEMS email delivery test requested by ${requestedBy}.\n\n` +
        `If you are reading this, transactional email works: verification codes, password resets ` +
        `and notification emails will reach their recipients.\n\n` +
        `Host: ${transport.host}:${transport.port}\nFrom: ${transport.from}\nSent at: ${stamp}\n\n— FEMS`,
      html: this.wrap(
        'Email delivery test',
        `<p>This is a FEMS email delivery test requested by <strong>${this.escape(requestedBy)}</strong>.</p>
         <p>If you are reading this, transactional email works: verification codes, password resets and
            notification emails will reach their recipients.</p>
         <table style="font-size:13px;color:#4b5563;border-collapse:collapse">
           <tr><td style="padding:2px 12px 2px 0">Host</td><td>${this.escape(`${transport.host}:${transport.port}`)}</td></tr>
           <tr><td style="padding:2px 12px 2px 0">From</td><td>${this.escape(transport.from ?? '')}</td></tr>
           <tr><td style="padding:2px 12px 2px 0">Sent at</td><td>${this.escape(stamp)}</td></tr>
         </table>`,
      ),
    });
  }

  private hoursUntil(expiresAt: Date): number {
    return Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 3_600_000));
  }

  private escape(value: string): string {
    return value.replace(/[&<>"']/g, (character) => {
      const map: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      };
      return map[character] ?? character;
    });
  }

  private wrap(title: string, body: string): string {
    return `<!doctype html><html><body style="margin:0;background:#f4f6f4;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif">
      <div style="max-width:560px;margin:24px auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8e2">
        <div style="background:#14532d;color:#ffffff;padding:18px 24px;font-size:18px;font-weight:700">FEMS</div>
        <div style="padding:24px;color:#1f2937;font-size:15px;line-height:1.55">
          <h2 style="margin:0 0 12px;font-size:18px;color:#14532d">${title}</h2>
          ${body}
        </div>
        <div style="padding:14px 24px;background:#f9fafb;color:#6b7280;font-size:12px">
          Forest Exploitation Management System — Cameroon forestry regulation (demo deployment)
        </div>
      </div>
    </body></html>`;
  }
}
