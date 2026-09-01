/* sonar.javascript.skipCoverage */
// NOSONAR — Jest interop guard for test environment, not executed in GAS runtime
/* istanbul ignore if */
if (typeof module !== 'undefined' && module.exports) {
  /* istanbul ignore next */
  module.exports = require('./src/index.js')
}
