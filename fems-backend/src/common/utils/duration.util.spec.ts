import { parseDurationToMs, parseDurationToSeconds } from './duration.util';

describe('duration.util', () => {
  it('parses the durations used by the JWT configuration', () => {
    expect(parseDurationToMs('15m')).toBe(900_000);
    expect(parseDurationToMs('30d')).toBe(2_592_000_000);
    expect(parseDurationToMs('12h')).toBe(43_200_000);
    expect(parseDurationToMs('2w')).toBe(1_209_600_000);
    expect(parseDurationToMs('500ms')).toBe(500);
    expect(parseDurationToMs('90s')).toBe(90_000);
    expect(parseDurationToMs('45')).toBe(2_700_000); // bare numbers default to minutes, as in jsonwebtoken
  });

  it('is case and whitespace tolerant', () => {
    expect(parseDurationToMs(' 1D ')).toBe(86_400_000);
  });

  it('falls back instead of throwing on unparsable input', () => {
    expect(parseDurationToMs('forever', 1234)).toBe(1234);
    expect(parseDurationToMs('', 5000)).toBe(5000);
    expect(parseDurationToSeconds('nonsense', 60)).toBe(60);
  });

  it('converts to seconds for the expiresIn hint returned to clients', () => {
    expect(parseDurationToSeconds('15m')).toBe(900);
    expect(parseDurationToSeconds('30d')).toBe(2_592_000);
  });
});
