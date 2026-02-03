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
  // different lengths should return false (covers early length check)
  expect(rowsEqual(['a'], ['a','b'])).toBe(false);
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

  // pre-populate sheet with two rows that won't be in calendar
  sheet.__getRows().push(['x1', 'A']);
  sheet.__getRows().push(['x2', 'B']);

  // ensure calendar is empty
  calendar.__reset();

  await syncCalendarToSheet(calendar, sheet, { start: new Date('2026-02-01'), end: new Date('2026-02-03') });

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
