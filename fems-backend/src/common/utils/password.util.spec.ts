import { BadRequestException } from '@nestjs/common';
import { assertPasswordStrength, checkPasswordStrength, hashPassword, verifyPassword } from './password.util';

describe('password.util — policy', () => {
  it('accepts a password with upper, lower, digit and 8+ characters', () => {
    const result = checkPasswordStrength('Passw0rdFEMS');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('lists every missing requirement', () => {
    const result = checkPasswordStrength('abc');
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining(['at least 8 characters', 'one uppercase letter', 'one digit']),
    );
  });

  it('rejects over-long passwords', () => {
    const result = checkPasswordStrength(`Aa1${'x'.repeat(140)}`);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('at most 128 characters');
  });

  it('assertPasswordStrength throws a 400 WEAK_PASSWORD', () => {
    try {
      assertPasswordStrength('password');
      throw new Error('expected the policy to reject this password');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const body = (error as BadRequestException).getResponse() as { code: string; details: { requirements: string[] } };
      expect(body.code).toBe('WEAK_PASSWORD');
      expect(body.details.requirements).toContain('one uppercase letter');
    }
  });
});

describe('password.util — hashing', () => {
  it('produces a bcrypt hash that verifies and never stores the plain text', async () => {
    const hash = await hashPassword('Passw0rdFEMS');
    expect(hash).not.toContain('Passw0rdFEMS');
    expect(hash.startsWith('$2')).toBe(true);
    await expect(verifyPassword('Passw0rdFEMS', hash)).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('Passw0rdFEMS');
    await expect(verifyPassword('passw0rdfems', hash)).resolves.toBe(false);
  });

  it('salts each hash so identical passwords differ', async () => {
    const [first, second] = await Promise.all([hashPassword('Passw0rdFEMS'), hashPassword('Passw0rdFEMS')]);
    expect(first).not.toEqual(second);
  });

  it('returns false rather than throwing on malformed hashes', async () => {
    await expect(verifyPassword('anything', 'not-a-hash')).resolves.toBe(false);
    await expect(verifyPassword('anything', '')).resolves.toBe(false);
  });
});
