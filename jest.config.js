module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/test-utils/setup.js'],
  testMatch: ['**/tests/**/*.test.[jt]s?(x)']
};
