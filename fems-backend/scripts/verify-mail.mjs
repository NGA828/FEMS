#!/usr/bin/env node
/**
 * FEMS — SMTP configuration check.
 *
 * Reads fems-backend/.env (never a hardcoded credential), reports exactly what
 * is missing, opens a real connection to the SMTP server and — when a recipient
 * is given — sends a real test message. It does not need the API to be running.
 *
 * Usage:
 *   node scripts/verify-mail.mjs                      # configuration + handshake
 *   node scripts/verify-mail.mjs you@example.com      # also send a test email
 *   npm run mail:verify -- you@example.com
 *
 * Exit code 0 = email delivery works.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = process.cwd();

function loadEnv() {
  const envPath = path.join(root, '.env');
  if (!existsSync(envPath)) {
    console.log(`  note  no .env found at ${envPath} — reading the process environment only.`);
    return;
  }
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function fail(message, hint) {
  console.log(`\n  FAIL  ${message}`);
  if (hint) console.log(`        ${hint}`);
  process.exit(1);
}

loadEnv();

const provider = process.env.EMAIL_PROVIDER || (process.env.SMTP_HOST ? 'smtp' : 'none');
const host = process.env.SMTP_HOST ?? '';
const port = Number(process.env.SMTP_PORT ?? 587);
const user = process.env.SMTP_USER ?? '';
const password = process.env.SMTP_PASSWORD ?? '';
const from = process.env.SMTP_FROM ?? '';
const recipient = process.argv[2];

console.log('\nFEMS — email delivery check');
console.log('---------------------------');
console.log(`  provider   ${provider}`);
console.log(`  host       ${host || '(not set)'}:${host ? port : ''}`);
console.log(`  username   ${user || '(none — unauthenticated relay)'}`);
console.log(`  password   ${password ? '(set)' : '(not set)'}`);
console.log(`  from       ${from || '(not set)'}`);

const missing = [];
if (provider === 'none') missing.push('EMAIL_PROVIDER');
if (!host) missing.push('SMTP_HOST');
if (!port) missing.push('SMTP_PORT');
if (!from) missing.push('SMTP_FROM');
if (user && !password) missing.push('SMTP_PASSWORD');

if (missing.length > 0) {
  fail(
    `email delivery is not configured (missing: ${missing.join(', ')}).`,
    'Fill those values in fems-backend/.env — see the "Transactional email" block in .env.example.',
  );
}

let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch {
  fail('nodemailer is not installed.', 'Run: npm --prefix fems-backend install');
}

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: port === 465,
  auth: user ? { user, pass: password } : undefined,
  connectionTimeout: 15_000,
  greetingTimeout: 15_000,
  socketTimeout: 20_000,
});

try {
  await transporter.verify();
  console.log('\n  PASS  the SMTP server accepted the connection and the credentials.');
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  let hint = 'Check SMTP_HOST, SMTP_PORT and the firewall.';
  if (/535|Username and Password not accepted|BadCredentials/i.test(reason)) {
    hint =
      'Gmail rejects normal account passwords. Enable 2-Step Verification and create an App password at https://myaccount.google.com/apppasswords, then paste it (no spaces) into SMTP_PASSWORD.';
  } else if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i.test(reason)) {
    hint = 'The server could not be reached — wrong host/port, or outbound port 587/465 is blocked on this network.';
  } else if (/self.signed|certificate/i.test(reason)) {
    hint = 'TLS certificate problem: use port 587 (STARTTLS) or 465 (implicit TLS) against the real provider hostname.';
  }
  fail(`SMTP handshake failed: ${reason}`, hint);
}

if (!recipient) {
  console.log('\n  Pass an address to send a real test message:');
  console.log('      npm run mail:verify -- you@example.com\n');
  process.exit(0);
}

try {
  const info = await transporter.sendMail({
    from,
    to: recipient,
    subject: 'FEMS — email delivery test',
    text:
      'This is a FEMS email delivery test sent by scripts/verify-mail.mjs.\n\n' +
      `Host: ${host}:${port}\nFrom: ${from}\nSent at: ${new Date().toISOString()}\n\n— FEMS`,
  });
  console.log(`\n  PASS  test message accepted for ${recipient} (id ${info.messageId}).`);
  console.log('        Check the inbox — and the spam folder on the first send.\n');
  process.exit(0);
} catch (error) {
  fail(`the server refused the message: ${error instanceof Error ? error.message : String(error)}`);
}
