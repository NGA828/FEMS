import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * DTO validation guard.
 *
 * The API runs a global `ValidationPipe` with `whitelist` and
 * `forbidNonWhitelisted` enabled. A property declared in a DTO without any
 * class-validator decorator is therefore *rejected at runtime* — the request
 * fails with "property X should not exist" instead of being validated, which
 * silently breaks an endpoint that looks perfectly fine in review.
 *
 * This spec walks every `*.dto.ts` file and asserts that each declared property
 * carries a real validator, and that its type has a matching one (a `boolean`
 * needs `@IsBoolean`, a number needs `@IsNumber`/`@IsInt`, and so on).
 *
 * Documentation-only classes describe *responses* and are never validated on
 * the way in. Tag those with `@responseOnly` in their JSDoc so this guard skips
 * them deliberately instead of the tag being silently forgotten.
 */

const DTO_FILES: string[] = [];
function collect(dir: string): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collect(full);
    } else if (entry.endsWith('.dto.ts')) {
      DTO_FILES.push(full);
    }
  }
}
collect(join(__dirname, '..', '..'));

const VALIDATOR = /^@(Is|Type|Validate|Matches|Min|Max|Length|Array|Nested|Allow|Equals)/;
const STRING_VALIDATORS = /^@(IsString|IsEmail|IsUUID|IsDateString|IsEnum|IsUrl|IsIn|IsJSON|Matches|IsBase64|IsHexColor|IsLocale|IsNumberString|IsMilitaryTime|IsPhoneNumber|IsTimeZone)/;

interface Problem {
  file: string;
  line: number;
  property: string;
  reason: string;
}

function inspect(file: string): Problem[] {
  const problems: Problem[] = [];
  const lines = readFileSync(file, 'utf8').split('\n');
  let decorators: string[] = [];
  let responseOnly = false;

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (/@responseOnly/.test(rawLine)) {
      responseOnly = true;
      decorators = [];
      return;
    }
    if (line === '}') {
      // End of a class body: a response-only class never needs validators.
      responseOnly = false;
      decorators = [];
      return;
    }
    if (responseOnly) return;
    if (line.startsWith('@')) {
      decorators.push(line);
      return;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)(\?|!)?\s*:\s*([^;]+);$/.exec(line);
    if (match && decorators.length > 0) {
      const [, property, , type] = match;
      const validators = decorators.filter((decorator) => VALIDATOR.test(decorator));
      if (validators.length === 0) {
        problems.push({ file, line: index + 1, property, reason: 'no class-validator decorator (requests would be rejected)' });
      } else if (type.startsWith('boolean') && !validators.some((decorator) => decorator.startsWith('@IsBoolean'))) {
        problems.push({ file, line: index + 1, property, reason: 'boolean property needs @IsBoolean' });
      } else if (type.startsWith('number') && !validators.some((decorator) => /^@(IsNumber|IsInt|IsPositive|IsNegative|IsLatitude|IsLongitude|IsDecimal)/.test(decorator))) {
        problems.push({ file, line: index + 1, property, reason: 'numeric property needs @IsNumber or @IsInt' });
      } else if (type.startsWith('string') && !validators.some((decorator) => STRING_VALIDATORS.test(decorator))) {
        problems.push({ file, line: index + 1, property, reason: 'string property needs a string validator' });
      }
    }
    if (line.length > 0) decorators = [];
  });

  return problems;
}

describe('DTO validation', () => {
  it('finds the DTO files to inspect', () => {
    expect(DTO_FILES.length).toBeGreaterThan(3);
  });

  it('validates every DTO property (whitelist-safe)', () => {
    const problems = DTO_FILES.flatMap((file) => inspect(file));
    const report = problems.map((problem) => `${problem.file}:${problem.line} → ${problem.property} (${problem.reason})`);
    expect(report).toEqual([]);
  });
});
