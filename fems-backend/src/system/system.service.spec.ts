import { BadRequestException } from '@nestjs/common';
import { SystemService } from './system.service';
import { SystemController } from './system.controller';
import { PERMISSIONS_KEY, PERMISSIONS_ANY_KEY, type AuthenticatedUser } from '../common/decorators';
import type { AuditService } from '../audit/audit.service';
import type { MailService } from '../mail/mail.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Integration reporting.
 *
 * The contract the administration screens rely on: an integration is only
 * `READY` when it is both configured and reachable, and the test-email route
 * refuses to run (rather than reporting a fake success) when SMTP is absent.
 */

type MailDescription = ReturnType<MailService['describe']>;

const describedMail = (overrides: Partial<MailDescription> = {}): MailDescription => ({
  provider: 'smtp',
  configured: true,
  missing: [],
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  username: 'fe****@gmail.com',
  passwordSet: true,
  from: 'FEMS <no-reply@fems.cm>',
  ...overrides,
});

const admin: AuthenticatedUser = {
  id: 'user-1',
  email: 'admin@fems.cm',
  firstName: 'Admin',
  lastName: 'FEMS',
  roles: ['ADMINISTRATOR'],
  permissions: ['settings:manage'],
  companyId: null,
  status: 'ACTIVE',
};

function buildService(mail: Partial<MailService>, databaseUp = true) {
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const prisma = {
    $queryRaw: databaseUp ? jest.fn().mockResolvedValue([{ 1: 1 }]) : jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
  } as unknown as PrismaService;
  const service = new SystemService(mail as MailService, prisma, audit);
  return { service, audit, prisma };
}

describe('SystemService — mail integration', () => {
  it('is DISABLED when email was never configured', async () => {
    const { service } = buildService({
      describe: () => describedMail({ provider: 'none', configured: false, missing: ['EMAIL_PROVIDER', 'SMTP_HOST'], host: null, port: null }),
      verifyConnection: jest.fn(),
    });

    const report = await service.mailStatus(true);
    expect(report.state).toBe('DISABLED');
    expect(report.missing).toContain('SMTP_HOST');
    expect(report.summary).toMatch(/switched off/i);
  });

  it('is MISCONFIGURED when SMTP is half filled in', async () => {
    const { service } = buildService({
      describe: () => describedMail({ configured: false, missing: ['SMTP_PASSWORD'] }),
      verifyConnection: jest.fn(),
    });

    const report = await service.mailStatus(true);
    expect(report.state).toBe('MISCONFIGURED');
    expect(report.summary).toContain('SMTP_PASSWORD');
  });

  it('is READY only when the server answers the handshake', async () => {
    const { service } = buildService({
      describe: () => describedMail(),
      verifyConnection: jest.fn().mockResolvedValue({ configured: true, reachable: true }),
    });

    const report = await service.mailStatus(true);
    expect(report.state).toBe('READY');
    expect(report.details.verified).toBe(true);
  });

  it('is UNREACHABLE when the credentials are refused', async () => {
    const { service } = buildService({
      describe: () => describedMail(),
      verifyConnection: jest.fn().mockResolvedValue({ configured: true, reachable: false, error: '535 Username and Password not accepted' }),
    });

    const report = await service.mailStatus(true);
    expect(report.state).toBe('UNREACHABLE');
    expect(report.summary).toContain('535');
  });

  it('skips the network probe when probe=false', async () => {
    const verifyConnection = jest.fn();
    const { service } = buildService({ describe: () => describedMail(), verifyConnection });

    const report = await service.mailStatus(false);
    expect(verifyConnection).not.toHaveBeenCalled();
    expect(report.details.verified).toBe(false);
  });

  it('never leaks the password in the report', async () => {
    const { service } = buildService({
      describe: () => describedMail(),
      verifyConnection: jest.fn().mockResolvedValue({ configured: true, reachable: true }),
    });
    const report = await service.mailStatus(true);
    expect(Object.keys(report.details)).not.toContain('password');
    expect(report.details.passwordSet).toBe(true);
  });
});

describe('SystemService — integration list', () => {
  it('reports every dependency and flags an unreachable database', async () => {
    const { service } = buildService(
      { describe: () => describedMail(), verifyConnection: jest.fn().mockResolvedValue({ configured: true, reachable: true }) },
      false,
    );

    const payload = await service.integrations(true);
    expect(payload.integrations.map((entry) => entry.key)).toEqual(['mail', 'push', 'payments', 'ai', 'storage', 'database']);
    expect(payload.integrations.find((entry) => entry.key === 'database')?.state).toBe('UNREACHABLE');
  });
});

describe('SystemService — test email', () => {
  it('refuses to send when SMTP is not configured', async () => {
    const sendTestEmail = jest.fn();
    const { service } = buildService({
      describe: () => describedMail({ configured: false, missing: ['SMTP_HOST'] }),
      sendTestEmail,
    });

    await expect(service.sendTestEmail(admin, 'inspector@fems.cm')).rejects.toBeInstanceOf(BadRequestException);
    expect(sendTestEmail).not.toHaveBeenCalled();
  });

  it('falls back to the caller’s own address and records the audit entry', async () => {
    const sendTestEmail = jest.fn().mockResolvedValue({ status: 'SENT', messageId: '<id@fems.cm>' });
    const { service, audit } = buildService({ describe: () => describedMail(), sendTestEmail });

    const result = await service.sendTestEmail(admin, undefined);
    expect(sendTestEmail).toHaveBeenCalledWith('admin@fems.cm', expect.stringContaining('admin@fems.cm'));
    expect(result.status).toBe('SENT');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'MailTransport' }));
  });

  it('surfaces an SMTP refusal verbatim instead of reporting success', async () => {
    const sendTestEmail = jest.fn().mockResolvedValue({ status: 'FAILED', error: 'Mailbox unavailable' });
    const { service } = buildService({ describe: () => describedMail(), sendTestEmail });

    const result = await service.sendTestEmail(admin, 'nobody@fems.cm');
    expect(result.status).toBe('FAILED');
    expect(result.error).toBe('Mailbox unavailable');
    expect(result.message).toContain('Mailbox unavailable');
  });
});

describe('SystemController — authorisation metadata', () => {
  it('keeps reads behind settings:read and the test email behind settings:manage', () => {
    expect(Reflect.getMetadata(PERMISSIONS_ANY_KEY, SystemController.prototype.integrations)).toEqual([
      'settings:read',
      'settings:manage',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_ANY_KEY, SystemController.prototype.mail)).toEqual([
      'settings:read',
      'settings:manage',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, SystemController.prototype.sendTestEmail)).toEqual(['settings:manage']);
  });
});
