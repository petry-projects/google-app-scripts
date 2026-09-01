// NOSONAR — Jest interop guard, not testable in GAS runtime
/* c8 ignore start */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = require('./src/index.js')
}
/* c8 ignore stop */
