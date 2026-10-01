import net from 'node:net';
import type { AddressInfo } from 'node:net';
import type { MailService as MailServiceType } from './mail.service';

/**
 * Email delivery.
 *
 * The transport is exercised against a disposable in-process SMTP server, so
 * the test proves the real nodemailer path (handshake, AUTH, DATA) instead of
 * mocking it away. The configuration cases assert the one rule that matters:
 * FEMS never reports a message as sent when it was not.
 */

const SMTP_ENV_KEYS = ['EMAIL_PROVIDER', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'] as const;

/** Builds a MailService with a fresh configuration cache. */
function mailServiceWith(env: Partial<Record<(typeof SMTP_ENV_KEYS)[number], string>>): MailServiceType {
  for (const key of SMTP_ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { MailService } = require('./mail.service') as typeof import('./mail.service');
  return new MailService();
}

interface TestSmtp {
  port: number;
  messages: string[];
  close: () => Promise<void>;
}

/** Minimal SMTP server: EHLO → AUTH → MAIL/RCPT → DATA → QUIT. */
async function startTestSmtp(): Promise<TestSmtp> {
  const messages: string[] = [];
  const server = net.createServer((socket) => {
    let inData = false;
    let body = '';
    socket.write('220 localhost FEMS test SMTP\r\n');
    socket.on('data', (chunk) => {
      const text = chunk.toString();
      if (inData) {
        body += text;
        if (body.includes('\r\n.\r\n')) {
          inData = false;
          messages.push(body);
          body = '';
          socket.write('250 2.0.0 Ok: queued as TEST\r\n');
        }
        return;
      }
      for (const line of text.split('\r\n').filter(Boolean)) {
        const command = line.toUpperCase();
        if (command.startsWith('EHLO') || command.startsWith('HELO')) socket.write('250-localhost\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (command.startsWith('AUTH')) socket.write('235 2.7.0 Authentication successful\r\n');
        else if (command.startsWith('DATA')) {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (command.startsWith('QUIT')) {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else socket.write('250 2.0.0 Ok\r\n');
      }
    });
    socket.on('error', () => undefined);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    messages,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('MailService — configuration', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('reports every missing variable when nothing is configured', () => {
    const mail = mailServiceWith({});
    expect(mail.isConfigured).toBe(false);
    expect(mail.missingConfiguration()).toEqual(expect.arrayContaining(['EMAIL_PROVIDER', 'SMTP_HOST']));
  });

  it('treats a filled SMTP_HOST as an intent to enable email', () => {
    const mail = mailServiceWith({ SMTP_HOST: 'smtp.gmail.com', SMTP_FROM: 'FEMS <no-reply@fems.cm>' });
    expect(mail.describe().provider).toBe('smtp');
    expect(mail.isConfigured).toBe(true);
    expect(mail.missingConfiguration()).toEqual([]);
  });

  it('requires a password once a username is given', () => {
    const mail = mailServiceWith({
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_USER: 'fems.notifications@gmail.com',
      SMTP_FROM: 'FEMS <fems.notifications@gmail.com>',
    });
    expect(mail.missingConfiguration()).toContain('SMTP_PASSWORD');
    expect(mail.isConfigured).toBe(false);
  });

  it('never exposes the password and masks the username', () => {
    const mail = mailServiceWith({
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: '465',
      SMTP_USER: 'fems.notifications@gmail.com',
      SMTP_PASSWORD: 'app-password-value',
      SMTP_FROM: 'FEMS <fems.notifications@gmail.com>',
    });
    const described = mail.describe();
    expect(JSON.stringify(described)).not.toContain('app-password-value');
    expect(described.passwordSet).toBe(true);
    expect(described.username).toBe(`fe${'*'.repeat('fems.notifications'.length - 2)}@gmail.com`);
    expect(described.secure).toBe(true);
  });

  it('refuses to claim delivery when SMTP is absent', async () => {
    const mail = mailServiceWith({});
    const result = await mail.send({ to: 'inspector@fems.cm', subject: 'x', text: 'y' });
    expect(result.status).toBe('NOT_CONFIGURED');
    expect(result.messageId).toBeUndefined();
  });
});

describe('MailService — delivery against a real SMTP server', () => {
  const originalEnv = { ...process.env };
  let smtp: TestSmtp;

  beforeAll(async () => {
    smtp = await startTestSmtp();
  });

  afterAll(async () => {
    await smtp.close();
    process.env = { ...originalEnv };
  });

  const service = () =>
    mailServiceWith({
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtp.port),
      SMTP_FROM: 'FEMS <no-reply@fems.cm>',
    });

  it('verifies the connection', async () => {
    await expect(service().verifyConnection()).resolves.toEqual({ configured: true, reachable: true });
  });

  it('delivers a verification code and returns the message id', async () => {
    const result = await service().sendEmailVerification('amina@fems.cm', 'Amina', '482913', new Date(Date.now() + 86_400_000));
    expect(result.status).toBe('SENT');
    expect(result.messageId).toBeTruthy();
    expect(smtp.messages.at(-1)).toContain('amina@fems.cm');
  });

  it('delivers the administrator test email', async () => {
    const result = await service().sendTestEmail('minister@fems.cm', 'Admin FEMS <admin@fems.cm>');
    expect(result.status).toBe('SENT');
    expect(smtp.messages.at(-1)).toContain('minister@fems.cm');
  });

  it('reports a transport failure instead of swallowing it', async () => {
    const mail = mailServiceWith({
      EMAIL_PROVIDER: 'smtp',
      SMTP_HOST: '127.0.0.1',
      // Nothing listens here: the send must fail loudly.
      SMTP_PORT: '1',
      SMTP_FROM: 'FEMS <no-reply@fems.cm>',
    });
    const result = await mail.send({ to: 'inspector@fems.cm', subject: 'x', text: 'y' });
    expect(result.status).toBe('FAILED');
    expect(result.error).toBeTruthy();
  });
});
