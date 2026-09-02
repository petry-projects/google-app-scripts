/* istanbul ignore file */
/* sonar.javascript.skipCoverage */
// NOSONAR — Jest interop guard for test environment, not executed in GAS runtime
if (typeof module !== 'undefined' && module.exports) {
  /* istanbul ignore next */
  module.exports = require('./src/index.js')
}
