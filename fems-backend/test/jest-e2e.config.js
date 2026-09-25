/**
 * End-to-end configuration.
 *
 * `test:e2e` runs the flows against a real Nest application, a real MySQL
 * database and the real seed dataset — no mocking of the API, the guards or the
 * database. The suites share one application instance per file and use the
 * seeded demo accounts, exactly as a client would.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '..',
  testRegex: 'test/.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testEnvironment: 'node',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  // The flows run against one shared database, so they must not interleave.
  maxWorkers: 1,
  testTimeout: 60_000,
  setupFiles: ['<rootDir>/test/setup/env.ts'],
  verbose: true,
};
