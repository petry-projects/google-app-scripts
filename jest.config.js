module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/test-utils/setup.js'],
  testMatch: ['**/tests/**/*.test.[jt]s?(x)'],
  coverageThreshold: {
    './src/calendar-to-sheets/src/*.js': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100
    }
  }
};
