/* c8 ignore start */
/* sonar.javascript.skipCoverage — Jest interop guard (GAS native environment tested via exported functions) */
// NOSONAR — Jest interop guard for test environment, not executed in GAS runtime
if (typeof module !== 'undefined' && module.exports) {
  module.exports = require('./src/index.js')
}
/* c8 ignore stop */
