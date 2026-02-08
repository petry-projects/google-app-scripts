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
  sleep: (ms) => {}
};

global.Logger = {
  log: () => {}
};

global.DocumentApp = global.DocumentApp || {};
global.DocumentApp.ParagraphHeading = { HEADING_3: 'HEADING_3' };
global.DocumentApp.Attribute = { BOLD: 'BOLD' };

// Install richer mocks for GmailApp, DriveApp and DocumentApp
const { installGlobals, resetAll } = require('./mocks');
installGlobals(global);

afterEach(() => resetAll(global));

