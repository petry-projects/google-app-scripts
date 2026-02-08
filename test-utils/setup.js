// Basic globals to emulate small parts of the Apps Script runtime used in tests
global.Session = {
  getScriptTimeZone: () => 'UTC'
};

global.Utilities = {
  formatDate: (date, tz, format) => {
    // Simple deterministic formatting for tests
    const d = new Date(date);
    return d.toISOString();
  },
  // Provide a simple sleep stub used in code
  sleep: (ms) => {},
  // Mock MD5 hash computation
  computeDigest: (algorithm, bytes) => {
    // Simple deterministic hash for testing
    // Convert bytes to a string and create a fake hash
    const crypto = require('crypto');
    const hash = crypto.createHash('md5').update(Buffer.from(bytes)).digest();
    // Return as array of numbers (like GAS does)
    return Array.from(hash);
  },
  DigestAlgorithm: {
    MD5: 'MD5'
  }
};

global.Logger = {
  log: () => {}
};

// Install richer mocks for GmailApp, DriveApp and DocumentApp
const { installGlobals, resetAll } = require('./mocks');
installGlobals(global);

afterEach(() => resetAll(global));

