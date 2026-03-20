// Basic globals to emulate small parts of the Apps Script runtime used in tests
global.Session = {
  getScriptTimeZone: () => 'UTC',
}

global.Utilities = {
  formatDate: (date, tz, format) => {
    const d = new Date(date)
    if (format === 'yyyy-MM-dd') {
      return d.toISOString().slice(0, 10)
    }
    if (format === 'h:mm a') {
      const h = d.getUTCHours()
      const m = d.getUTCMinutes()
      const ampm = h >= 12 ? 'PM' : 'AM'
      const h12 = h % 12 || 12
      return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
    }
    return d.toISOString()
  },
  // Provide a simple sleep stub used in code
  sleep: (ms) => {},
  // Mock MD5 hash computation
  computeDigest: (algorithm, bytes) => {
    // Simple deterministic hash for testing
    // Convert bytes to a string and create a fake hash
    const crypto = require('crypto')
    const hash = crypto.createHash('md5').update(Buffer.from(bytes)).digest()
    // Return as array of numbers (like GAS does)
    return Array.from(hash)
  },
  DigestAlgorithm: {
    MD5: 'MD5',
  },
}

global.Logger = {
  log: () => {},
}

// Install richer mocks for GmailApp, DriveApp and DocumentApp
const { installGlobals, resetAll } = require('./mocks')
installGlobals(global)

afterEach(() => resetAll(global))
