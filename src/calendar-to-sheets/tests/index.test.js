const { installGlobals, resetAll, createCalendarEvent } = require('../../../test-utils/mocks');
const { eventToRow, syncCalendarToSheet, rowsEqual, rowsToMap } = require('../src/index');

beforeEach(() => {
  installGlobals(global);
  // prepare sheet header
  const ss = SpreadsheetApp.openById('ss1');
  const sheet = ss.getSheetByName('Sheet1');
  sheet.__setHeader(['id','title','start','end','description','location','attendees']);
});

afterEach(() => resetAll(global));

test('eventToRow includes attendees and dates', () => {
  const evt = createCalendarEvent({ id: 'e1', title: 'Meeting', start: new Date('2026-02-02T10:00:00Z'), end: new Date('2026-02-02T11:00:00Z'), description: 'desc', location: 'HQ', attendees: ['a@example.com','b@example.com'] });
  const row = eventToRow(evt);
  expect(row[0]).toBe('e1');
  expect(row[1]).toBe('Meeting');
  expect(row[2]).toBe(new Date('2026-02-02T10:00:00Z').toISOString());
  expect(row[6]).toBe('a@example.com,b@example.com');
});

test('syncCalendarToSheet adds, updates, and deletes rows correctly', async () => {
  const calendar = CalendarApp.getDefaultCalendar();
  const ss = SpreadsheetApp.openById('ss1');
  const sheet = ss.getSheetByName('Sheet1');

  // Add events
  const evt1 = createCalendarEvent({ id: 'e1', title: 'Meeting A', start: new Date('2026-02-02T10:00:00Z'), end: new Date('2026-02-02T11:00:00Z'), description: 'd1', location: 'L1', attendees: ['a@example.com'] });
  const evt2 = createCalendarEvent({ id: 'e2', title: 'Meeting B', start: new Date('2026-02-02T12:00:00Z'), end: new Date('2026-02-02T13:00:00Z'), description: 'd2', location: 'L2', attendees: [] });
  calendar.__addEvent(evt1);
  calendar.__addEvent(evt2);

  await syncCalendarToSheet(calendar, sheet, { start: new Date('2026-02-01'), end: new Date('2026-02-03') });

  const rows = sheet.__getRows();
  expect(rows.length).toBe(2);
  expect(rows[0][0]).toBe('e1');
  expect(rows[1][0]).toBe('e2');

  // Update evt1 title and attendees
  const evt1b = createCalendarEvent({ id: 'e1', title: 'Meeting A updated', start: new Date('2026-02-02T10:00:00Z'), end: new Date('2026-02-02T11:00:00Z'), description: 'd1', location: 'L1', attendees: ['a@example.com','c@example.com'] });
  calendar.__reset();
  calendar.__addEvent(evt1b);
  calendar.__addEvent(evt2);

  await syncCalendarToSheet(calendar, sheet, { start: new Date('2026-02-01'), end: new Date('2026-02-03') });

  const rows2 = sheet.__getRows();
  expect(rows2.length).toBe(2);
  const e1row = rows2.find(r => r[0] === 'e1');
  expect(e1row[1]).toBe('Meeting A updated');
  expect(e1row[6]).toBe('a@example.com,c@example.com');

  // Remove evt2
  calendar.__reset();
  calendar.__addEvent(evt1b);
  await syncCalendarToSheet(calendar, sheet, { start: new Date('2026-02-01'), end: new Date('2026-02-03') });
  const rows3 = sheet.__getRows();
  expect(rows3.length).toBe(1);
  expect(rows3[0][0]).toBe('e1');
});

test('rowsToMap builds correct mapping and rowsEqual works', () => {
  const rows = [['e1','a'], ['e2','b']];
  const m = rowsToMap(rows);
  expect(m.has('e1')).toBe(true);
  expect(m.get('e2').rowIndex).toBe(3); // header row considered
  expect(rowsEqual(['a','b'], ['a','b'])).toBe(true);
  expect(rowsEqual(['a','b'], ['a','c'])).toBe(false);
  // when b has extra trailing columns, only compare columns in a
  expect(rowsEqual(['a','b'], ['a','b','extra','columns'])).toBe(true);
  expect(rowsEqual(['a','b'], ['a','c','extra','columns'])).toBe(false);
});

test('eventToRow handles missing optional fields', () => {
  const evt = createCalendarEvent({ id: 'e3', title: 'No extras', start: new Date('2026-02-03T10:00:00Z'), end: new Date('2026-02-03T11:00:00Z') });
  const row = eventToRow(evt);
  expect(row[4]).toBe(''); // description
  expect(row[5]).toBe(''); // location
  expect(row[6]).toBe(''); // attendees
});

test('syncCalendarToSheet skips update when rows are equal', async () => {
  const calendar = CalendarApp.getDefaultCalendar();
  const ss = SpreadsheetApp.openById('ss1');
  const sheet = ss.getSheetByName('Sheet1');

  const evt = createCalendarEvent({ id: 'e4', title: 'Stable meeting', start: new Date('2026-02-04T10:00:00Z'), end: new Date('2026-02-04T11:00:00Z'), description: 'x', location: 'L', attendees: [] });
  calendar.__addEvent(evt);
  await syncCalendarToSheet(calendar, sheet, { start: new Date('2026-02-01'), end: new Date('2026-02-06') });
  const before = JSON.stringify(sheet.__getRows());
  // No changes
  await syncCalendarToSheet(calendar, sheet, { start: new Date('2026-02-01'), end: new Date('2026-02-06') });
  const after = JSON.stringify(sheet.__getRows());
  expect(before).toBe(after);
});

test('syncCalendarToSheet ignores extra user columns when comparing rows', async () => {
  const calendar = CalendarApp.getDefaultCalendar();
  const ss = SpreadsheetApp.openById('ss1');
  const sheet = ss.getSheetByName('Sheet1');

  const evt = createCalendarEvent({ id: 'e_extra', title: 'Meeting with notes', start: new Date('2026-02-04T10:00:00Z'), end: new Date('2026-02-04T11:00:00Z'), description: 'desc', location: 'L', attendees: ['a@example.com'] });
  calendar.__addEvent(evt);
  
  // First sync
  await syncCalendarToSheet(calendar, sheet, { start: new Date('2026-02-01'), end: new Date('2026-02-06') });
  
  // Simulate user adding extra columns (notes) to the row
  const rows = sheet.__getRows();
  const targetRow = rows.find(r => r[0] === 'e_extra');
  targetRow.push('User note 1', 'User note 2', 'Extra data');
  
  // Second sync - should NOT update the row because script-owned columns are identical
  await syncCalendarToSheet(calendar, sheet, { start: new Date('2026-02-01'), end: new Date('2026-02-06') });
  
  const rowsAfter = sheet.__getRows();
  const rowAfter = rowsAfter.find(r => r[0] === 'e_extra');
  
  // User notes should still be there (row was not rewritten)
  expect(rowAfter.length).toBeGreaterThan(7); // more than the 7 script columns
  expect(rowAfter[7]).toBe('User note 1');
  expect(rowAfter[8]).toBe('User note 2');
  expect(rowAfter[9]).toBe('Extra data');
});

test('rowsToMap skips empty rows and sync uses default date range', async () => {
  const calendar = CalendarApp.getDefaultCalendar();
  const ss = SpreadsheetApp.openById('ss1');
  const sheet = ss.getSheetByName('Sheet1');

  // Put some invalid rows in sheet data
  sheet.__getRows().push([null]);
  sheet.__getRows().push([]);

  const m = rowsToMap(sheet.__getRows());
  expect(m.has(null)).toBe(false);

  // Add an event and call sync without start/end to use defaults
  const evt = createCalendarEvent({ id: 'e5', title: 'Default range', start: new Date(), end: new Date(Date.now()+3600000) });
  calendar.__addEvent(evt);
  await syncCalendarToSheet(calendar, sheet);
  const rows = sheet.__getRows();
  expect(rows.find(r => r[0] === 'e5')).toBeTruthy();
});

test('eventToRow handles null guest list and sync handles empty data array', async () => {
  // eventToRow with null guest list
  const evt = { getId: () => 'enul', getTitle: () => 'NoGuests', getStartTime: () => new Date('2026-02-05T10:00:00Z'), getEndTime: () => new Date('2026-02-05T11:00:00Z'), getDescription: () => null, getLocation: () => null, getGuestList: () => null };
  const row = eventToRow(evt);
  expect(row[6]).toBe('');

  // sync with a sheet that returns empty getValues array
  const calendar = CalendarApp.getDefaultCalendar();
  calendar.__reset();
  calendar.__addEvent(createCalendarEvent({ id: 'enul', title: 'NoGuests', start: new Date(), end: new Date(Date.now()+1000) }));

  const sheet = {
    getDataRange: () => ({ getValues: () => [] }),
    appendRow: (r) => { sheet._rows = sheet._rows || []; sheet._rows.push(r); },
    getRange: () => ({ setValues: () => {} }),
    deleteRow: () => {},
    __getRows: () => sheet._rows || []
  };

  await syncCalendarToSheet(calendar, sheet);
  expect(sheet.__getRows().find(r => r[0] === 'enul')).toBeTruthy();
});

test('syncCalendarToSheet skips deleting rows with missing date columns', async () => {
  const calendar = CalendarApp.getDefaultCalendar();
  const ss = SpreadsheetApp.openById('ss1');
  const sheet = ss.getSheetByName('Sheet1');

  // Pre-populate sheet with rows that have invalid/missing date columns
  sheet.__getRows().push(['x1', 'A', null, null]); // both dates null
  sheet.__getRows().push(['x2', 'B', '2026-02-02T10:00:00Z', null]); // end date null
  sheet.__getRows().push(['x3', 'C', null, '2026-02-02T11:00:00Z']); // start date null

  // ensure calendar is empty
  calendar.__reset();

  await syncCalendarToSheet(calendar, sheet, { start: new Date('2026-02-01'), end: new Date('2026-02-03') });

  // All rows should remain because they have missing dates
  expect(sheet.__getRows().length).toBe(3);
});

test('syncCalendarToSheet preserves rows with dates outside sync window', async () => {
  const calendar = CalendarApp.getDefaultCalendar();
  const ss = SpreadsheetApp.openById('ss1');
  const sheet = ss.getSheetByName('Sheet1');

  // Pre-populate sheet with row outside sync window
  sheet.__getRows().push(['x1', 'Before window', '2026-01-15T10:00:00Z', '2026-01-15T11:00:00Z']);
  sheet.__getRows().push(['x2', 'After window', '2026-02-10T10:00:00Z', '2026-02-10T11:00:00Z']);

  // ensure calendar is empty (so these events don't exist in calendar)
  calendar.__reset();

  // Sync with a window that doesn't include these events
  await syncCalendarToSheet(calendar, sheet, { start: new Date('2026-02-01'), end: new Date('2026-02-03') });

  // Both rows should remain because they're outside the sync window
  expect(sheet.__getRows().length).toBe(2);
  expect(sheet.__getRows()[0][0]).toBe('x1');
  expect(sheet.__getRows()[1][0]).toBe('x2');
});

test('syncCalendarToSheet deletes multiple rows and calls sort comparator', async () => {
  const calendar = CalendarApp.getDefaultCalendar();
  const ss = SpreadsheetApp.openById('ss1');
  const sheet = ss.getSheetByName('Sheet1');

  // pre-populate sheet with two rows that have dates within the sync window
  const start = new Date('2026-02-01');
  const end = new Date('2026-02-03');
  sheet.__getRows().push(['x1', 'A', start.toISOString(), end.toISOString()]);
  sheet.__getRows().push(['x2', 'B', start.toISOString(), end.toISOString()]);

  // ensure calendar is empty
  calendar.__reset();

  await syncCalendarToSheet(calendar, sheet, { start, end });

  expect(sheet.__getRows().length).toBe(0);
});

// Ensure the GAS wrapper can sync multiple configs in SYNC_CONFIGS
test('syncAllCalendarsToSheetsGAS syncs multiple configs to multiple sheets', async () => {
  const code = require('../code.gs');

  // Use two configs pointing at the same spreadsheet but different sheets
  global.SYNC_CONFIGS = [
    { spreadsheetId: 'ss1', sheetName: 'SheetA', calendarId: '' },
    { spreadsheetId: 'ss1', sheetName: 'SheetB', calendarId: '' }
  ];

  const ss = SpreadsheetApp.openById('ss1');
  const sheetA = ss.getSheetByName('SheetA');
  const sheetB = ss.getSheetByName('SheetB');
  sheetA.__setHeader(['id','title','start','end','description','location','attendees']);
  sheetB.__setHeader(['id','title','start','end','description','location','attendees']);

  const calendar = CalendarApp.getDefaultCalendar();
  const evt = createCalendarEvent({ id: 'em', title: 'MultiEvent', start: new Date('2026-02-02T10:00:00Z'), end: new Date('2026-02-02T11:00:00Z'), description: 'd', location: 'L', attendees: [] });
  calendar.__addEvent(evt);

  await code.syncAllCalendarsToSheetsGAS('2026-02-01', '2026-02-03');

  expect(sheetA.__getRows().find(r => r[0] === 'em')).toBeTruthy();
  expect(sheetB.__getRows().find(r => r[0] === 'em')).toBeTruthy();

  delete global.SYNC_CONFIGS;
});

// Test checkpoint logic for avoiding reprocessing old events
describe('Checkpoint logic (GAS only)', () => {
  beforeEach(() => {
    installGlobals(global);
  });

  afterEach(() => resetAll(global));

  test('getCheckpointKey returns consistent key for config', () => {
    const code = require('../code.gs');
    const cfg = { calendarId: 'cal123' };
    const key = code.getCheckpointKey(cfg);
    expect(key).toBe('calendar_to_sheets_last_sync_cal123');
  });

  test('getLastSyncTime defaults to epoch on first run', () => {
    const code = require('../code.gs');
    const cfg = { calendarId: 'new_cal' };
    const lastSync = code.getLastSyncTime(cfg);
    // Should be epoch (Jan 1, 1970)
    expect(lastSync.getTime()).toBe(0);
  });

  test('saveLastSyncTime and getLastSyncTime persist checkpoint', () => {
    const code = require('../code.gs');
    const cfg = { calendarId: 'cal456' };
    const testTime = new Date('2026-01-15T10:00:00Z');
    
    code.saveLastSyncTime(cfg, testTime);
    const retrieved = code.getLastSyncTime(cfg);
    
    expect(retrieved.getTime()).toBe(testTime.getTime());
  });

  test('clearCheckpoint removes saved sync time', () => {
    const code = require('../code.gs');
    const cfg = { calendarId: 'cal789' };
    const testTime = new Date('2026-01-15T10:00:00Z');
    
    code.saveLastSyncTime(cfg, testTime);
    code.clearCheckpoint(cfg);
    
    const retrieved = code.getLastSyncTime(cfg);
    // Should be reset to epoch
    expect(retrieved.getTime()).toBe(0);
  });

  test('syncCalendarToSheetGAS saves checkpoint after successful sync', () => {
    const code = require('../code.gs');
    
    // Clear any existing config
    delete global.SYNC_CONFIGS;
    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
    delete global.CALENDAR_ID;
    
    global.SPREADSHEET_ID = 'ss1';
    global.SHEET_NAME = 'Sheet1';
    
    const ss = SpreadsheetApp.openById('ss1');
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);
    
    const calendar = CalendarApp.getDefaultCalendar();
    const evt = createCalendarEvent({ id: 'e1', title: 'Test', start: new Date('2026-02-02T10:00:00Z'), end: new Date('2026-02-02T11:00:00Z'), description: 'd', location: 'L', attendees: [] });
    calendar.__addEvent(evt);

    code.syncCalendarToSheetGAS('2026-02-01', '2026-02-03');

    const cfg = code.getConfig();
    const lastSync = code.getLastSyncTime(cfg);
    expect(lastSync.getTime()).toBe(new Date('2026-02-03').getTime());
    
    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
    delete global.CALENDAR_ID;
  });

  test('syncAllCalendarsToSheetsGAS handles errors and continues with other calendars', () => {
    const code = require('../code.gs');
    
    global.SYNC_CONFIGS = [
      { spreadsheetId: 'ss1', sheetName: 'SheetA', calendarId: 'cal1' },
      { spreadsheetId: 'ss1', sheetName: 'SheetB', calendarId: 'cal2' }
    ];

    const ss = SpreadsheetApp.openById('ss1');
    const sheetA = ss.getSheetByName('SheetA');
    const sheetB = ss.getSheetByName('SheetB');
    sheetA.__setHeader(['id','title','start','end','description','location','attendees']);
    sheetB.__setHeader(['id','title','start','end','description','location','attendees']);

    const calendar = CalendarApp.getDefaultCalendar();
    const evt = createCalendarEvent({ id: 'e2', title: 'Test2', start: new Date('2026-02-02T10:00:00Z'), end: new Date('2026-02-02T11:00:00Z'), description: 'd', location: 'L', attendees: [] });
    calendar.__addEvent(evt);

    // Mock Logger for error handling
    global.Logger = { log: jest.fn() };

    code.syncAllCalendarsToSheetsGAS('2026-02-01', '2026-02-03');

    // Both sheets should have the event
    expect(sheetA.__getRows().find(r => r[0] === 'e2')).toBeTruthy();
    expect(sheetB.__getRows().find(r => r[0] === 'e2')).toBeTruthy();

    delete global.SYNC_CONFIGS;
    delete global.Logger;
  });

  test('fullResyncCalendarToSheetGAS clears checkpoint and syncs', () => {
    const code = require('../code.gs');
    
    global.SYNC_CONFIGS = [{ spreadsheetId: 'ss1', sheetName: 'Sheet1', calendarId: 'cal1' }];

    const ss = SpreadsheetApp.openById('ss1');
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);

    const calendar = CalendarApp.getDefaultCalendar();
    const evt = createCalendarEvent({ id: 'e3', title: 'Test3', start: new Date('2026-02-02T10:00:00Z'), end: new Date('2026-02-02T11:00:00Z'), description: 'd', location: 'L', attendees: [] });
    calendar.__addEvent(evt);

    // Set a checkpoint first
    const cfg = code.getConfigs()[0];
    code.saveLastSyncTime(cfg, new Date('2025-01-01'));

    // Full resync
    code.fullResyncCalendarToSheetGAS(0);

    // Should have synced and updated checkpoint
    const lastSync = code.getLastSyncTime(cfg);
    expect(lastSync.getTime()).toBeGreaterThan(new Date('2026-01-01').getTime());

    delete global.SYNC_CONFIGS;
  });

  test('getConfigs returns legacy single config when SYNC_CONFIGS not defined', () => {
    
    
    // Clear existing configs
    delete global.SYNC_CONFIGS;
    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
    delete global.CALENDAR_ID;
    
    global.SPREADSHEET_ID = 'legacy_ss';
    global.SHEET_NAME = 'LegacySheet';
    global.CALENDAR_ID = 'legacy_cal';

    // Clear require cache to force re-evaluation
    delete require.cache[require.resolve('../code.gs')];
    const freshCode = require('../code.gs');
    
    const configs = freshCode.getConfigs();
    
    expect(configs.length).toBe(1);
    expect(configs[0].spreadsheetId).toBe('legacy_ss');
    expect(configs[0].sheetName).toBe('LegacySheet');
    expect(configs[0].calendarId).toBe('legacy_cal');

    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
    delete global.CALENDAR_ID;
  });

  test('getConfigs returns defaults when legacy vars are undefined', () => {
    // Clear all configs
    delete global.SYNC_CONFIGS;
    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
    delete global.CALENDAR_ID;

    delete require.cache[require.resolve('../code.gs')];
    const freshCode = require('../code.gs');
    
    const configs = freshCode.getConfigs();
    
    expect(configs.length).toBe(1);
    expect(configs[0].spreadsheetId).toBe(null);
    expect(configs[0].sheetName).toBe('Sheet1');
    expect(configs[0].calendarId).toBe(null);
  });

  test('getConfigs handles non-array SYNC_CONFIGS', () => {
    delete global.SYNC_CONFIGS;
    global.SYNC_CONFIGS = 'not_an_array';

    delete require.cache[require.resolve('../code.gs')];
    const freshCode = require('../code.gs');
    
    const configs = freshCode.getConfigs();
    
    // Should fall back to legacy mode
    expect(configs.length).toBe(1);
    expect(configs[0].sheetName).toBe('Sheet1');
    
    delete global.SYNC_CONFIGS;
  });

  test('getCheckpointKey handles default calendar', () => {
    const code = require('../code.gs');
    const cfg = { calendarId: null };
    const key = code.getCheckpointKey(cfg);
    expect(key).toBe('calendar_to_sheets_last_sync_default');
  });

  test('_syncCalendarToSheetGAS skips update when row values are identical', () => {
    const code = require('../code.gs');
    
    global.SPREADSHEET_ID = 'ss1';
    global.SHEET_NAME = 'Sheet1';
    
    const ss = SpreadsheetApp.openById('ss1');
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);
    
    const calendar = CalendarApp.getDefaultCalendar();
    const evt = createCalendarEvent({ 
      id: 'e_same', 
      title: 'Same Event', 
      start: new Date('2026-02-02T10:00:00Z'), 
      end: new Date('2026-02-02T11:00:00Z'), 
      description: 'desc', 
      location: 'loc', 
      attendees: ['a@example.com'] 
    });
    calendar.__addEvent(evt);

    // First sync
    code.syncCalendarToSheetGAS('2026-02-01', '2026-02-03');
    const rowsBefore = sheet.__getRows();
    
    // Second sync with same data (should not update)
    code.syncCalendarToSheetGAS('2026-02-01', '2026-02-03');
    const rowsAfter = sheet.__getRows();
    
    expect(rowsAfter).toEqual(rowsBefore);
    
    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
  });

  test('_syncCalendarToSheetGAS deletes rows for removed events', () => {
    const code = require('../code.gs');
    
    global.SPREADSHEET_ID = 'ss1';
    global.SHEET_NAME = 'Sheet1';
    
    const ss = SpreadsheetApp.openById('ss1');
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);
    
    const calendar = CalendarApp.getDefaultCalendar();
    const evt1 = createCalendarEvent({ id: 'e_del1', title: 'Event 1', start: new Date('2026-02-02T10:00:00Z'), end: new Date('2026-02-02T11:00:00Z'), description: '', location: '', attendees: [] });
    const evt2 = createCalendarEvent({ id: 'e_del2', title: 'Event 2', start: new Date('2026-02-02T12:00:00Z'), end: new Date('2026-02-02T13:00:00Z'), description: '', location: '', attendees: [] });
    calendar.__addEvent(evt1);
    calendar.__addEvent(evt2);

    // First sync with both events
    code.syncCalendarToSheetGAS('2026-02-01', '2026-02-03');
    expect(sheet.__getRows().length).toBe(2);
    
    // Remove one event and sync again
    calendar.__reset();
    calendar.__addEvent(evt1);
    code.syncCalendarToSheetGAS('2026-02-01', '2026-02-03');
    
    const rows = sheet.__getRows();
    expect(rows.length).toBe(1);
    expect(rows[0][0]).toBe('e_del1');
    
    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
  });

  test('syncAllCalendarsToSheetsGAS logs errors when Logger is available', () => {
    const code = require('../code.gs');
    
    // Create a mock that will throw an error
    const originalOpenById = SpreadsheetApp.openById;
    SpreadsheetApp.openById = jest.fn(() => {
      throw new Error('Spreadsheet not found');
    });
    
    global.SYNC_CONFIGS = [
      { spreadsheetId: 'invalid_ss', sheetName: 'BadSheet', calendarId: 'bad_cal' }
    ];
    
    global.Logger = { log: jest.fn() };
    
    // This should trigger an error but not throw
    code.syncAllCalendarsToSheetsGAS('2026-02-01', '2026-02-03');
    
    // Logger should have been called with error
    expect(global.Logger.log).toHaveBeenCalled();
    expect(global.Logger.log.mock.calls[0][0]).toContain('Error syncing calendar');
    
    // Restore
    SpreadsheetApp.openById = originalOpenById;
    delete global.SYNC_CONFIGS;
    delete global.Logger;
  });

  test('syncAllCalendarsToSheetsGAS handles errors when Logger.log is undefined', () => {
    const code = require('../code.gs');
    
    // Create a mock that will throw an error
    const originalOpenById = SpreadsheetApp.openById;
    SpreadsheetApp.openById = jest.fn(() => {
      throw new Error('Spreadsheet not found');
    });
    
    global.SYNC_CONFIGS = [
      { spreadsheetId: 'invalid_ss', sheetName: 'BadSheet', calendarId: 'bad_cal' }
    ];
    
    // Set Logger but without a log method
    global.Logger = {};
    
    // This should not crash even though Logger exists but doesn't have log method
    expect(() => {
      code.syncAllCalendarsToSheetsGAS('2026-02-01', '2026-02-03');
    }).not.toThrow();
    
    // Restore
    SpreadsheetApp.openById = originalOpenById;
    delete global.SYNC_CONFIGS;
    delete global.Logger;
  });

  test('syncAllCalendarsToSheetsGAS handles errors when Logger is completely undefined', () => {
    const code = require('../code.gs');
    
    // Create a mock that will throw an error
    const originalOpenById = SpreadsheetApp.openById;
    SpreadsheetApp.openById = jest.fn(() => {
      throw new Error('Spreadsheet not found');
    });
    
    global.SYNC_CONFIGS = [
      { spreadsheetId: 'invalid_ss', sheetName: 'BadSheet', calendarId: 'bad_cal' }
    ];
    
    // Make sure Logger is not defined at all
    delete global.Logger;
    
    // This should not crash when Logger is undefined
    expect(() => {
      code.syncAllCalendarsToSheetsGAS('2026-02-01', '2026-02-03');
    }).not.toThrow();
    
    // Restore
    SpreadsheetApp.openById = originalOpenById;
    delete global.SYNC_CONFIGS;
  });

  test('_syncCalendarToSheetGAS uses getActiveSpreadsheet when spreadsheetId is null', () => {
    const code = require('../code.gs');
    
    global.SYNC_CONFIGS = [{ spreadsheetId: null, sheetName: 'Sheet1', calendarId: null }];
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);
    
    const calendar = CalendarApp.getDefaultCalendar();
    const evt = createCalendarEvent({ id: 'e_active', title: 'Active SS Test', start: new Date('2026-02-02T10:00:00Z'), end: new Date('2026-02-02T11:00:00Z'), description: '', location: '', attendees: [] });
    calendar.__addEvent(evt);

    code.syncAllCalendarsToSheetsGAS('2026-02-01', '2026-02-03');

    expect(sheet.__getRows().find(r => r[0] === 'e_active')).toBeTruthy();
    
    delete global.SYNC_CONFIGS;
  });

  test('_syncCalendarToSheetGAS falls back to first sheet when named sheet not found', () => {
    const code = require('../code.gs');
    
    global.SYNC_CONFIGS = [{ spreadsheetId: 'ss1', sheetName: 'NonExistent', calendarId: null }];
    
    const ss = SpreadsheetApp.openById('ss1');
    // Mock getSheetByName to return null for NonExistent sheet
    const originalGetSheetByName = ss.getSheetByName.bind(ss);
    ss.getSheetByName = (name) => {
      if (name === 'NonExistent') return null;
      return originalGetSheetByName(name);
    };
    
    const firstSheet = ss.getSheets()[0];
    firstSheet.__setHeader(['id','title','start','end','description','location','attendees']);
    
    const calendar = CalendarApp.getDefaultCalendar();
    const evt = createCalendarEvent({ id: 'e_fallback', title: 'Fallback Test', start: new Date('2026-02-02T10:00:00Z'), end: new Date('2026-02-02T11:00:00Z'), description: '', location: '', attendees: [] });
    calendar.__addEvent(evt);

    code.syncAllCalendarsToSheetsGAS('2026-02-01', '2026-02-03');

    expect(firstSheet.__getRows().find(r => r[0] === 'e_fallback')).toBeTruthy();
    
    delete global.SYNC_CONFIGS;
  });

  test('eventToRowGAS handles missing description and location', () => {
    const code = require('../code.gs');
    const evt = createCalendarEvent({ 
      id: 'e_minimal', 
      title: 'Minimal Event', 
      start: new Date('2026-02-02T10:00:00Z'), 
      end: new Date('2026-02-02T11:00:00Z'), 
      description: null, 
      location: null, 
      attendees: null 
    });
    
    const row = code.eventToRowGAS(evt);
    
    expect(row[4]).toBe(''); // description
    expect(row[5]).toBe(''); // location
    expect(row[6]).toBe(''); // attendees
  });

  test('incremental sync preserves historical events outside sync window', () => {
    const code = require('../code.gs');
    
    global.SPREADSHEET_ID = 'ss1';
    global.SHEET_NAME = 'Sheet1';
    
    const ss = SpreadsheetApp.openById('ss1');
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);
    
    const calendar = CalendarApp.getDefaultCalendar();
    
    // Create events in different time windows
    const oldEvent = createCalendarEvent({ 
      id: 'e_old', 
      title: 'Old Event', 
      start: new Date('2025-01-15T10:00:00Z'), 
      end: new Date('2025-01-15T11:00:00Z'), 
      description: '', 
      location: '', 
      attendees: [] 
    });
    
    const recentEvent = createCalendarEvent({ 
      id: 'e_recent', 
      title: 'Recent Event', 
      start: new Date('2026-02-02T10:00:00Z'), 
      end: new Date('2026-02-02T11:00:00Z'), 
      description: '', 
      location: '', 
      attendees: [] 
    });
    
    // Add both events and do a full sync
    calendar.__addEvent(oldEvent);
    calendar.__addEvent(recentEvent);
    code.syncCalendarToSheetGAS('2025-01-01', '2026-03-01');
    
    expect(sheet.__getRows().length).toBe(2);
    
    // Now simulate an incremental sync from Feb 1 onwards
    // The old event (Jan 2025) is NOT deleted from calendar, but it's outside the sync window
    calendar.__reset();
    calendar.__addEvent(oldEvent); // still exists in calendar
    calendar.__addEvent(recentEvent); // still exists in calendar
    
    // Sync only Feb-March window
    code.syncCalendarToSheetGAS('2026-02-01', '2026-03-01');
    
    // Both events should still be in the sheet
    const rows = sheet.__getRows();
    expect(rows.length).toBe(2);
    expect(rows.find(r => r[0] === 'e_old')).toBeTruthy();
    expect(rows.find(r => r[0] === 'e_recent')).toBeTruthy();
    
    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
  });

  test('incremental sync deletes events within sync window but preserves those outside', () => {
    const code = require('../code.gs');
    
    global.SPREADSHEET_ID = 'ss1';
    global.SHEET_NAME = 'Sheet1';
    
    const ss = SpreadsheetApp.openById('ss1');
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);
    
    const calendar = CalendarApp.getDefaultCalendar();
    
    // Create events in different time windows
    const oldEvent = createCalendarEvent({ 
      id: 'e_old', 
      title: 'Old Event', 
      start: new Date('2025-01-15T10:00:00Z'), 
      end: new Date('2025-01-15T11:00:00Z'), 
      description: '', 
      location: '', 
      attendees: [] 
    });
    
    const recentEvent1 = createCalendarEvent({ 
      id: 'e_recent1', 
      title: 'Recent Event 1', 
      start: new Date('2026-02-02T10:00:00Z'), 
      end: new Date('2026-02-02T11:00:00Z'), 
      description: '', 
      location: '', 
      attendees: [] 
    });
    
    const recentEvent2 = createCalendarEvent({ 
      id: 'e_recent2', 
      title: 'Recent Event 2', 
      start: new Date('2026-02-03T10:00:00Z'), 
      end: new Date('2026-02-03T11:00:00Z'), 
      description: '', 
      location: '', 
      attendees: [] 
    });
    
    // Add all events and do a full sync
    calendar.__addEvent(oldEvent);
    calendar.__addEvent(recentEvent1);
    calendar.__addEvent(recentEvent2);
    code.syncCalendarToSheetGAS('2025-01-01', '2026-03-01');
    
    expect(sheet.__getRows().length).toBe(3);
    
    // Now delete recentEvent2 from calendar and do incremental sync
    // The old event should remain, recentEvent1 should remain, recentEvent2 should be deleted
    calendar.__reset();
    calendar.__addEvent(oldEvent);
    calendar.__addEvent(recentEvent1);
    // recentEvent2 is deleted from calendar
    
    // Sync only Feb-March window
    code.syncCalendarToSheetGAS('2026-02-01', '2026-03-01');
    
    // Old event should be preserved (outside window), recentEvent1 kept, recentEvent2 deleted
    const rows = sheet.__getRows();
    expect(rows.length).toBe(2);
    expect(rows.find(r => r[0] === 'e_old')).toBeTruthy();
    expect(rows.find(r => r[0] === 'e_recent1')).toBeTruthy();
    expect(rows.find(r => r[0] === 'e_recent2')).toBeUndefined();
    
    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
  });

  test('incremental sync handles events with missing start dates gracefully', () => {
    const code = require('../code.gs');
    
    global.SPREADSHEET_ID = 'ss1';
    global.SHEET_NAME = 'Sheet1';
    
    const ss = SpreadsheetApp.openById('ss1');
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);
    
    const calendar = CalendarApp.getDefaultCalendar();
    const evt = createCalendarEvent({
      id: 'e_safe',
      title: '=MALICIOUS()',
      start: new Date('2026-02-02T10:00:00Z'),
      end: new Date('2026-02-02T11:00:00Z'),
      description: '@IMPORTDATA("http://evil.com")',
      location: '+DANGEROUS',
      attendees: []
    });
    calendar.__addEvent(evt);

    code.syncCalendarToSheetGAS('2026-02-01', '2026-02-03');
    
    const rows = sheet.__getRows();
    expect(rows.length).toBe(1);
    expect(rows[0][1]).toBe("'=MALICIOUS()"); // title sanitized
    expect(rows[0][4]).toBe("'@IMPORTDATA(\"http://evil.com\")"); // description sanitized
    expect(rows[0][5]).toBe("'+DANGEROUS"); // location sanitized
    
    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
  });

  test('eventToRowGAS handles non-string and empty values', () => {
    const code = require('../code.gs');
    
    // Test with event that has non-string title
    const evt1 = {
      getId: () => 'e_nonstring',
      getTitle: () => 123,
      getStartTime: () => new Date('2026-02-02T10:00:00Z'),
      getEndTime: () => new Date('2026-02-02T11:00:00Z'),
      getDescription: () => null,
      getLocation: () => undefined,
      getGuestList: () => []
    };
    
    const row1 = code.eventToRowGAS(evt1);
    expect(row1[1]).toBe(123); // non-string passes through
    
    // Test with empty string values
    const evt2 = createCalendarEvent({
      id: 'e_empty',
      title: '',
      start: new Date('2026-02-02T10:00:00Z'),
      end: new Date('2026-02-02T11:00:00Z'),
      description: '',
      location: '',
      attendees: []
    });
    
    const row2 = code.eventToRowGAS(evt2);
    expect(row2[1]).toBe(''); // empty string passes through unchanged
    expect(row2[4]).toBe('');
    expect(row2[5]).toBe('');
  });

  test('eventToRowGAS handles null guest list', () => {
    const code = require('../code.gs');
    const evt = { 
      getId: () => 'e_nullguests', 
      getTitle: () => 'No Guests', 
      getStartTime: () => new Date('2026-02-02T10:00:00Z'), 
      getEndTime: () => new Date('2026-02-02T11:00:00Z'), 
      getDescription: () => '',
      getLocation: () => '',
      getGuestList: () => null  // null guest list
    };
    const row = code.eventToRowGAS(evt);
    expect(row[6]).toBe(''); // attendees should be empty string
  });

  test('_syncCalendarToSheetGAS handles sheet data with null rows', () => {
    const code = require('../code.gs');
    
    global.SPREADSHEET_ID = 'ss1';
    global.SHEET_NAME = 'Sheet1';
    
    const ss = SpreadsheetApp.openById('ss1');
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);
    
    // Mock getDataRange to return data with null/undefined rows
    const originalGetDataRange = sheet.getDataRange;
    sheet.getDataRange = () => ({
      getValues: () => [
        ['id','title','start','end','description','location','attendees'], // header
        ['e1', 'Valid', '2026-02-02T10:00:00Z', '2026-02-02T11:00:00Z', '', '', ''], // valid row
        null, // null row
        undefined, // undefined row
        ['', '', '', '', '', '', ''], // row with empty id
      ]
    });
    
    const calendar = CalendarApp.getDefaultCalendar();
    const evt = createCalendarEvent({ 
      id: 'e1', 
      title: 'Valid', 
      start: new Date('2026-02-02T10:00:00Z'), 
      end: new Date('2026-02-02T11:00:00Z'), 
      description: '', 
      location: '', 
      attendees: [] 
    });
    calendar.__addEvent(evt);

    // This should not crash despite null/undefined rows
    code.syncCalendarToSheetGAS('2026-02-01', '2026-02-03');
    
    // Restore
    sheet.getDataRange = originalGetDataRange;
    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
  });

  test('_syncCalendarToSheetGAS handles config with null sheetName', () => {
    const code = require('../code.gs');
    
    // Use a config with null sheetName to trigger the ternary
    global.SYNC_CONFIGS = [{ spreadsheetId: 'ss1', sheetName: null, calendarId: null }];
    
    const ss = SpreadsheetApp.openById('ss1');
    const defaultSheet = ss.getSheets()[0];
    defaultSheet.__setHeader(['id','title','start','end','description','location','attendees']);
    
    const calendar = CalendarApp.getDefaultCalendar();
    const evt = createCalendarEvent({ 
      id: 'e_null_sheet', 
      title: 'Null Sheet Name', 
      start: new Date('2026-02-02T10:00:00Z'), 
      end: new Date('2026-02-02T11:00:00Z'), 
      description: '', 
      location: '', 
      attendees: [] 
    });
    calendar.__addEvent(evt);

    code.syncAllCalendarsToSheetsGAS('2026-02-01', '2026-02-03');

    expect(defaultSheet.__getRows().find(r => r[0] === 'e_null_sheet')).toBeTruthy();
    
    delete global.SYNC_CONFIGS;
  });

  test('_syncCalendarToSheetGAS preserves rows with null start date in column', () => {
    const code = require('../code.gs');
    
    global.SPREADSHEET_ID = 'ss1';
    global.SHEET_NAME = 'Sheet1';
    
    const ss = SpreadsheetApp.openById('ss1');
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);
    
    // Pre-populate sheet with a row that has null in the start date column (index 2)
    sheet.__getRows().push(['x_nullstart', 'No Start Date', null, '2026-02-02T11:00:00Z', '', '', '']);
    
    const calendar = CalendarApp.getDefaultCalendar();
    calendar.__reset(); // Empty calendar

    // Sync - the row with null start should not be deleted
    code.syncCalendarToSheetGAS('2026-02-01', '2026-02-03');

    expect(sheet.__getRows().length).toBe(1);
    expect(sheet.__getRows()[0][0]).toBe('x_nullstart');
    
    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
  });

  test('_syncCalendarToSheetGAS deletes events at exact boundary dates', () => {
    const code = require('../code.gs');
    
    global.SPREADSHEET_ID = 'ss1';
    global.SHEET_NAME = 'Sheet1';
    
    const ss = SpreadsheetApp.openById('ss1');
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);
    
    const calendar = CalendarApp.getDefaultCalendar();
    
    // Create events at and within boundaries
    const startBoundary = new Date('2026-02-01T00:00:00Z');
    const endBoundary = new Date('2026-02-03T00:00:00Z');
    
    const evtAtStart = createCalendarEvent({ 
      id: 'e_start', 
      title: 'At Start', 
      start: startBoundary, 
      end: new Date('2026-02-01T01:00:00Z'), 
      description: '', 
      location: '', 
      attendees: [] 
    });
    
    const evtWithin = createCalendarEvent({ 
      id: 'e_within', 
      title: 'Within Range', 
      start: new Date('2026-02-02T12:00:00Z'), 
      end: new Date('2026-02-02T13:00:00Z'), 
      description: '', 
      location: '', 
      attendees: [] 
    });
    
    // Add event manually to sheet to simulate historical data outside sync window
    const evtBeyond = createCalendarEvent({ 
      id: 'e_beyond', 
      title: 'Beyond End', 
      start: new Date('2026-02-04T00:00:00Z'), 
      end: new Date('2026-02-04T01:00:00Z'), 
      description: '', 
      location: '', 
      attendees: [] 
    });
    
    calendar.__addEvent(evtAtStart);
    calendar.__addEvent(evtWithin);
    
    // First sync - should add events within range
    code.syncCalendarToSheetGAS('2026-02-01', '2026-02-03');
    
    // Manually add the beyond event to sheet (simulating historical data)
    sheet.__getRows().push([
      'e_beyond',
      'Beyond End',
      new Date('2026-02-04T00:00:00Z').toISOString(),
      new Date('2026-02-04T01:00:00Z').toISOString(),
      '',
      '',
      ''
    ]);
    
    expect(sheet.__getRows().length).toBe(3); // 2 synced + 1 manual
    
    // Remove evtAtStart and evtWithin from calendar
    calendar.__reset();
    
    // Sync again - events within boundaries should be deleted, beyond should remain
    code.syncCalendarToSheetGAS('2026-02-01', '2026-02-03');
    
    const rows = sheet.__getRows();
    expect(rows.length).toBe(1);
    expect(rows[0][0]).toBe('e_beyond'); // Only beyond-boundary event remains
    
    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
  });

  test('_syncCalendarToSheetGAS triggers update when row values differ', () => {
    const code = require('../code.gs');
    
    global.SPREADSHEET_ID = 'ss1';
    global.SHEET_NAME = 'Sheet1';
    
    const ss = SpreadsheetApp.openById('ss1');
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);
    
    const calendar = CalendarApp.getDefaultCalendar();
    
    // Add initial event
    const evt1 = createCalendarEvent({ 
      id: 'e_update', 
      title: 'Original Title', 
      start: new Date('2026-02-02T10:00:00Z'), 
      end: new Date('2026-02-02T11:00:00Z'), 
      description: 'Original Desc', 
      location: 'Original Loc', 
      attendees: ['a@example.com'] 
    });
    calendar.__addEvent(evt1);
    
    code.syncCalendarToSheetGAS('2026-02-01', '2026-02-03');
    const rowsBefore = sheet.__getRows();
    expect(rowsBefore[0][1]).toBe('Original Title');
    
    // Update event with different values in multiple columns
    const evt2 = createCalendarEvent({ 
      id: 'e_update', 
      title: 'Updated Title', 
      start: new Date('2026-02-02T10:00:00Z'), 
      end: new Date('2026-02-02T11:00:00Z'), 
      description: 'Updated Desc', 
      location: 'Updated Loc', 
      attendees: ['b@example.com', 'c@example.com'] 
    });
    calendar.__reset();
    calendar.__addEvent(evt2);
    
    code.syncCalendarToSheetGAS('2026-02-01', '2026-02-03');
    const rowsAfter = sheet.__getRows();
    
    expect(rowsAfter[0][1]).toBe('Updated Title');
    expect(rowsAfter[0][4]).toBe('Updated Desc');
    expect(rowsAfter[0][5]).toBe('Updated Loc');
    expect(rowsAfter[0][6]).toBe('b@example.com,c@example.com');
    
    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
  });


  test('_syncCalendarToSheetGAS with specific calendar ID', () => {
    const code = require('../code.gs');
    
    global.SYNC_CONFIGS = [{ spreadsheetId: 'ss1', sheetName: 'Sheet1', calendarId: 'specific_cal_id' }];
    
    // Mock CalendarApp.getCalendarById
    const originalGetCalendarById = CalendarApp.getCalendarById;
    const mockCalendar = CalendarApp.getDefaultCalendar();
    CalendarApp.getCalendarById = jest.fn(() => mockCalendar);
    
    const ss = SpreadsheetApp.openById('ss1');
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);
    
    const evt = createCalendarEvent({ 
      id: 'e_specific', 
      title: 'Specific Cal', 
      start: new Date('2026-02-02T10:00:00Z'), 
      end: new Date('2026-02-02T11:00:00Z'), 
      description: '', 
      location: '', 
      attendees: [] 
    });
    mockCalendar.__addEvent(evt);

    code.syncAllCalendarsToSheetsGAS('2026-02-01', '2026-02-03');

    expect(CalendarApp.getCalendarById).toHaveBeenCalledWith('specific_cal_id');
    expect(sheet.__getRows().find(r => r[0] === 'e_specific')).toBeTruthy();
    
    // Restore
    CalendarApp.getCalendarById = originalGetCalendarById;
    delete global.SYNC_CONFIGS;
  });

  test('getConfig returns null when configs array is empty', () => {
    // Clear all configs to force getConfig to create an empty config
    delete global.SYNC_CONFIGS;
    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
    delete global.CALENDAR_ID;
    
    // Set SYNC_CONFIGS to empty array
    global.SYNC_CONFIGS = [];
    
    delete require.cache[require.resolve('../code.gs')];
    const freshCode = require('../code.gs');
    
    const result = freshCode.getConfig();
    // getConfig returns cfgs[0] || null, so with empty array it should return undefined || null = null
    expect(result).toBe(null);
    
    delete global.SYNC_CONFIGS;
  });

  test('syncCalendarToSheetGAS uses checkpoint when dates not provided', () => {
    const code = require('../code.gs');
    
    delete global.SYNC_CONFIGS;
    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
    delete global.CALENDAR_ID;
    
    global.SPREADSHEET_ID = 'ss1';
    global.SHEET_NAME = 'Sheet1';
    
    const ss = SpreadsheetApp.openById('ss1');
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);
    
    const calendar = CalendarApp.getDefaultCalendar();
    const evt = createCalendarEvent({ 
      id: 'e_nodate', 
      title: 'No Date Params', 
      start: new Date(), 
      end: new Date(Date.now() + 3600000), 
      description: '', 
      location: '', 
      attendees: [] 
    });
    calendar.__addEvent(evt);

    // Call without date parameters (null or undefined)
    code.syncCalendarToSheetGAS(null, null);
    
    expect(sheet.__getRows().find(r => r[0] === 'e_nodate')).toBeTruthy();
    
    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
  });

  test('syncAllCalendarsToSheetsGAS uses checkpoint when dates not provided', () => {
    const code = require('../code.gs');
    
    global.SYNC_CONFIGS = [
      { spreadsheetId: 'ss1', sheetName: 'SheetA', calendarId: null }
    ];
    
    const ss = SpreadsheetApp.openById('ss1');
    const sheetA = ss.getSheetByName('SheetA');
    sheetA.__setHeader(['id','title','start','end','description','location','attendees']);
    
    const calendar = CalendarApp.getDefaultCalendar();
    const evt = createCalendarEvent({ 
      id: 'e_nodate2', 
      title: 'No Date Params All', 
      start: new Date(), 
      end: new Date(Date.now() + 3600000), 
      description: '', 
      location: '', 
      attendees: [] 
    });
    calendar.__addEvent(evt);

    // Call without date parameters
    code.syncAllCalendarsToSheetsGAS(null, null);
    
    expect(sheetA.__getRows().find(r => r[0] === 'e_nodate2')).toBeTruthy();
    
    delete global.SYNC_CONFIGS;
  });
});

// Test the sanitizeValue function from code.gs directly
describe('sanitizeValue from code.gs', () => {
  test('sanitizes strings starting with formula metacharacters', () => {
    const code = require('../code.gs');
    
    expect(code.sanitizeValue('=FORMULA()')).toBe("'=FORMULA()");
    expect(code.sanitizeValue('+123')).toBe("'+123");
    expect(code.sanitizeValue('-456')).toBe("'-456");
    expect(code.sanitizeValue('@IMPORT')).toBe("'@IMPORT");
  });

  test('returns non-string values unchanged', () => {
    const code = require('../code.gs');
    
    expect(code.sanitizeValue(123)).toBe(123);
    expect(code.sanitizeValue(null)).toBe(null);
    expect(code.sanitizeValue(undefined)).toBe(undefined);
    expect(code.sanitizeValue(true)).toBe(true);
  });

  test('returns safe strings unchanged', () => {
    const code = require('../code.gs');
    
    expect(code.sanitizeValue('normal text')).toBe('normal text');
    expect(code.sanitizeValue('123 numbers')).toBe('123 numbers');
    expect(code.sanitizeValue('')).toBe('');
  });
});

// Test eventToRow to cover index.js sanitizeValue branches
describe('eventToRow edge cases for sanitization', () => {
  test('eventToRow sanitizes non-string values passed through', () => {
    const evt = {
      getId: () => 'e1',
      getTitle: () => 123, // non-string
      getStartTime: () => new Date('2026-02-02T10:00:00Z'),
      getEndTime: () => new Date('2026-02-02T11:00:00Z'),
      getDescription: () => null,
      getLocation: () => undefined,
      getGuestList: () => []
    };
    const row = eventToRow(evt);
    expect(row[1]).toBe(123); // non-string values should pass through
  });

  test('eventToRow sanitizes formula injection in all string fields', () => {
    const evt = {
      getId: () => 'e_formula',
      getTitle: () => '=MALICIOUS()',
      getStartTime: () => new Date('2026-02-02T10:00:00Z'),
      getEndTime: () => new Date('2026-02-02T11:00:00Z'),
      getDescription: () => '+DANGEROUS',
      getLocation: () => '-ATTACK',
      getGuestList: () => []
    };
    const row = eventToRow(evt);
    expect(row[1]).toBe("'=MALICIOUS()");
    expect(row[4]).toBe("'+DANGEROUS");
    expect(row[5]).toBe("'-ATTACK");
  });
});



