import { BadRequestException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { appConfig } from '../../config/configuration';

/**
 * Password policy + hashing.
 * bcrypt (cost configurable, default 10) with a per-password salt — plain-text
 * passwords are never stored, logged or returned.
 */
export async function hashPassword(plain: string): Promise<string> {
  assertPasswordStrength(plain);
  return bcrypt.hash(plain, appConfig().security.bcryptRounds);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export interface PasswordPolicyResult {
  valid: boolean;
  errors: string[];
  score: number;
}

export function checkPasswordStrength(password: string): PasswordPolicyResult {
  const errors: string[] = [];
  if (!password || password.length < 8) errors.push('at least 8 characters');
  if (!/[A-Z]/.test(password)) errors.push('one uppercase letter');
  if (!/[a-z]/.test(password)) errors.push('one lowercase letter');
  if (!/[0-9]/.test(password)) errors.push('one digit');
  if (password.length > 128) errors.push('at most 128 characters');
  const score = Math.max(
    0,
    100 - errors.length * 20 + Math.min(20, password.length - 8) - (/[^A-Za-z0-9]/.test(password) ? 0 : 10),
  );
  return { valid: errors.length === 0, errors, score };
}

export function assertPasswordStrength(password: string): void {
  const result = checkPasswordStrength(password);
  if (!result.valid) {
    throw new BadRequestException({
      code: 'WEAK_PASSWORD',
      message: `The password must contain ${result.errors.join(', ')}.`,
      details: { requirements: result.errors },
    });
  }
}
