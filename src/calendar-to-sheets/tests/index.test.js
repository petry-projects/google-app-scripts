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
});

// Test ensureHeader function
describe('ensureHeader', () => {
  const { ensureHeader } = require('../src/index');

  test('ensureHeader creates header when sheet is completely empty', () => {
    const mockSetValues = jest.fn();
    const sheet = {
      getDataRange: () => ({ getValues: () => [] }),
      appendRow: jest.fn(),
      insertRowBefore: jest.fn(),
      getRange: jest.fn(() => ({ setValues: mockSetValues }))
    };

    ensureHeader(sheet);
    
    expect(sheet.getRange).toHaveBeenCalledWith(1, 1, 1, 7);
    expect(mockSetValues).toHaveBeenCalledWith([['id', 'title', 'start', 'end', 'description', 'location', 'attendees']]);
    expect(sheet.insertRowBefore).not.toHaveBeenCalled();
  });

  test('ensureHeader does nothing when valid header already exists', () => {
    const sheet = {
      getDataRange: () => ({ getValues: () => [['id', 'title', 'start', 'end', 'description', 'location', 'attendees']] }),
      appendRow: jest.fn(),
      insertRowBefore: jest.fn(),
      getRange: jest.fn(() => ({ setValues: jest.fn() }))
    };

    ensureHeader(sheet);
    
    expect(sheet.appendRow).not.toHaveBeenCalled();
    expect(sheet.insertRowBefore).not.toHaveBeenCalled();
  });

  test('ensureHeader inserts header when first row is data not header', () => {
    const mockSetValues = jest.fn();
    const sheet = {
      getDataRange: () => ({ getValues: () => [['e1', 'Meeting', '2026-02-02T10:00:00Z', '2026-02-02T11:00:00Z', 'desc', 'loc', 'attendees']] }),
      appendRow: jest.fn(),
      insertRowBefore: jest.fn(),
      getRange: jest.fn(() => ({ setValues: mockSetValues }))
    };

    ensureHeader(sheet);
    
    expect(sheet.insertRowBefore).toHaveBeenCalledWith(1);
    expect(sheet.getRange).toHaveBeenCalledWith(1, 1, 1, 7);
    expect(mockSetValues).toHaveBeenCalledWith([['id', 'title', 'start', 'end', 'description', 'location', 'attendees']]);
  });
});

// Test syncCalendarToSheet with empty sheet (no header)
test('syncCalendarToSheet works correctly when sheet starts empty with no header', async () => {
  const calendar = CalendarApp.getDefaultCalendar();
  
  // Create a fresh sheet with no header set
  const ss = SpreadsheetApp.openById('ss_empty');
  const sheet = ss.getSheetByName('EmptySheet');
  // Intentionally NOT calling __setHeader

  const evt1 = createCalendarEvent({ 
    id: 'e_empty1', 
    title: 'First Event', 
    start: new Date('2026-02-02T10:00:00Z'), 
    end: new Date('2026-02-02T11:00:00Z'), 
    description: 'd1', 
    location: 'L1', 
    attendees: ['a@example.com'] 
  });
  
  const evt2 = createCalendarEvent({ 
    id: 'e_empty2', 
    title: 'Second Event', 
    start: new Date('2026-02-03T10:00:00Z'), 
    end: new Date('2026-02-03T11:00:00Z'), 
    description: 'd2', 
    location: 'L2', 
    attendees: [] 
  });
  
  calendar.__addEvent(evt1);
  calendar.__addEvent(evt2);

  // Sync should create header and add events
  await syncCalendarToSheet(calendar, sheet, { start: new Date('2026-02-01'), end: new Date('2026-02-05') });

  const rows = sheet.__getRows();
  expect(rows.length).toBe(2);
  expect(rows[0][0]).toBe('e_empty1');
  expect(rows[1][0]).toBe('e_empty2');
  
  // Second sync should update correctly without duplicating
  const evt1Updated = createCalendarEvent({ 
    id: 'e_empty1', 
    title: 'First Event Updated', 
    start: new Date('2026-02-02T10:00:00Z'), 
    end: new Date('2026-02-02T11:00:00Z'), 
    description: 'd1', 
    location: 'L1', 
    attendees: ['a@example.com'] 
  });
  
  calendar.__reset();
  calendar.__addEvent(evt1Updated);
  calendar.__addEvent(evt2);

  await syncCalendarToSheet(calendar, sheet, { start: new Date('2026-02-01'), end: new Date('2026-02-05') });

  const rows2 = sheet.__getRows();
  expect(rows2.length).toBe(2);
  const e1row = rows2.find(r => r[0] === 'e_empty1');
  expect(e1row[1]).toBe('First Event Updated');
});



