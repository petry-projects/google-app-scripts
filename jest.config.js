module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/test-utils/setup.js'],
  testMatch: ['**/tests/**/*.test.[jt]s?(x)'],
  collectCoverageFrom: [
    'src/**/*.{js,gs}',
    '!**/node_modules/**',
    '!**/coverage/**',
    '!**/tests/**'
  ],
  coverageThreshold: {
    global: {
      branches: 85,
      functions: 95,
      lines: 100,
      statements: 95
    }
  }
};
