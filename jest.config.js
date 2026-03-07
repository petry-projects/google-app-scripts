module.exports = {
  preset: 'ts-jest/presets/js-with-ts',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/test-utils/setup.js'],
  testMatch: ['**/tests/**/*.test.[jt]s?(x)'],
  transform: {
    '^.+\\.[jt]sx?$': [
      'ts-jest',
      {
        tsconfig: {
          allowJs: true,
          strict: false,
        },
        diagnostics: false,
      },
    ],
  },
  collectCoverageFrom: [
    'src/**/*.{js,ts,gs}',
    '!**/node_modules/**',
    '!**/coverage/**',
    '!**/tests/**',
  ],
  coverageThreshold: {
    global: {
      branches: 85,
      functions: 95,
      lines: 99,
      statements: 95,
    },
  },
}
