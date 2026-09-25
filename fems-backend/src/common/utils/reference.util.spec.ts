import { References, formatDateStamp, formatDateTimeStamp, uniqueReference } from './reference.util';

describe('reference.util', () => {
  it('stamps dates in UTC', () => {
    expect(formatDateStamp(new Date('2026-03-09T22:15:00Z'))).toBe('20260309');
    expect(formatDateTimeStamp(new Date('2026-03-09T22:15:07Z'))).toBe('20260309-221507');
  });

  it('builds human-readable, prefixed references', () => {
    const date = new Date('2026-03-09T00:00:00Z');
    expect(References.permit('COMMERCIAL', date)).toMatch(/^FEMS-COM-20260309-[A-Z0-9]{6}$/);
    expect(References.activity(date)).toMatch(/^ACT-20260309-[A-Z0-9]{6}$/);
    expect(References.inspection(date)).toMatch(/^INS-20260309-[A-Z0-9]{6}$/);
    expect(References.violation(date)).toMatch(/^VIO-20260309-[A-Z0-9]{6}$/);
    expect(References.alert(date)).toMatch(/^ALR-20260309-[A-Z0-9]{6}$/);
    expect(References.receipt(date)).toMatch(/^RCP-20260309-[A-Z0-9]{6}$/);
  });

  it('generates unique values across many calls', () => {
    const generated = new Set(Array.from({ length: 500 }, () => References.activity()));
    expect(generated.size).toBe(500);
  });

  it('creates collision-free storage keys', () => {
    const key = References.fileKey('permits/documents', '.PDF');
    expect(key).toMatch(/^permits\/documents\/\d{8}\/[0-9a-f-]{36}\.PDF$/);
  });

  it('retries until the availability check passes', async () => {
    let attempts = 0;
    const reference = await uniqueReference(
      () => `REF-${(attempts += 1)}`,
      async (candidate) => candidate === 'REF-3',
    );
    expect(reference).toBe('REF-3');
    expect(attempts).toBe(3);
  });

  it('throws a clear error when it cannot find a free reference', async () => {
    await expect(uniqueReference(() => 'TAKEN', async () => false, 3)).rejects.toThrow(
      'Could not generate a unique reference',
    );
  });
});
