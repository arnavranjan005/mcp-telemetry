// Shared ts-jest transform: packages compile to NodeNext ESM for production
// (tsc, via each package's own tsconfig.json), but tests run through ts-jest
// with an inline CommonJS override instead — avoids Jest's ESM setup entirely
// while leaving the real build untouched. moduleNameMapper strips the trailing
// `.js` NodeNext requires on relative imports (e.g. `./job.js`) so ts-jest can
// resolve them back to the `.ts` source files it's compiling on the fly.
const tsJestTransform = {
  '^.+\\.ts$': ['ts-jest', {
    tsconfig: {
      module: 'commonjs',
      moduleResolution: 'node',
      target: 'es2020',
      esModuleInterop: true,
      strict: true,
    },
  }],
};

const moduleNameMapper = { '^(\\.{1,2}/.*)\\.js$': '$1' };

module.exports = {
  testTimeout: 20000,
  projects: [
    {
      displayName: 'sdk',
      testEnvironment: 'node',
      rootDir: '<rootDir>/packages/sdk',
      testMatch: ['<rootDir>/src/__tests__/**/*.test.ts'],
      transform: tsJestTransform,
      moduleNameMapper,
    },
    {
      displayName: 'server',
      testEnvironment: 'node',
      rootDir: '<rootDir>/packages/server',
      testMatch: ['<rootDir>/src/__tests__/**/*.test.ts'],
      transform: tsJestTransform,
      moduleNameMapper: {
        ...moduleNameMapper,
        '^mcp-telemetry-sdk$': '<rootDir>/../sdk/src/index.ts',
      },
    },
    {
      displayName: 'e2e',
      testEnvironment: 'node',
      rootDir: '<rootDir>/test/e2e',
      testMatch: ['<rootDir>/**/*.test.ts'],
      transform: tsJestTransform,
      moduleNameMapper: {
        ...moduleNameMapper,
        // Runs the sdk producer in-process from source (compiled on the fly);
        // the server side of these tests spawns the real compiled
        // dist/bin/server.js as a separate process instead — see helpers.ts.
        '^mcp-telemetry-sdk$': '<rootDir>/../../packages/sdk/src/index.ts',
      },
    },
  ],
};
