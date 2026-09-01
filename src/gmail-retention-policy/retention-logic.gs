/**
 * Wrapper for retention logic that allows Google Apps Script to access
 * functions defined in src/index.js. When running under Jest, tests import
 * directly from src/index.js which is a .js file that SonarCloud recognizes.
 */

/* c8 ignore start */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = require('./src/index.js')
}
/* c8 ignore stop */
