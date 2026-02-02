/**
 * GAS wrapper for Calendar to Sheets.
 *
 * Place configuration in `config.gs` (spreadsheetId, sheetName, calendarId).
 * This file is primarily a wrapper that can run in Google Apps Script.
 */

function getConfig() {
  return {
    spreadsheetId: typeof SPREADSHEET_ID !== 'undefined' ? SPREADSHEET_ID : null,
    sheetName: typeof SHEET_NAME !== 'undefined' ? SHEET_NAME : 'Sheet1',
    calendarId: typeof CALENDAR_ID !== 'undefined' ? CALENDAR_ID : null
  };
}

function eventToRowGAS(event) {
  const id = event.getId();
  const title = event.getTitle();
  const start = event.getStartTime().toISOString();
  const end = event.getEndTime().toISOString();
  const description = event.getDescription() || '';
  const location = event.getLocation() || '';
  const attendees = (event.getGuestList() || []).map(g => g.getEmail()).join(',');
  return [id, title, start, end, description, location, attendees];
}

function syncCalendarToSheetGAS(startIso, endIso) {
  const cfg = getConfig();
  const start = startIso ? new Date(startIso) : new Date(0);
  const end = endIso ? new Date(endIso) : new Date(Date.now() + 365*24*60*60*1000);

  const calendar = cfg.calendarId ? CalendarApp.getCalendarById(cfg.calendarId) : CalendarApp.getDefaultCalendar();
  const ss = cfg.spreadsheetId ? SpreadsheetApp.openById(cfg.spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(cfg.sheetName) || ss.getSheets()[0];

  const events = calendar.getEvents(start, end);
  const desired = events.map(eventToRowGAS);
  const desiredMap = new Map(desired.map(r => [r[0], r]));

  const data = sheet.getDataRange().getValues();
  const body = data.slice(1);

  const existingMap = new Map();
  for (let i = 0; i < body.length; i++) {
    const r = body[i];
    if (!r || !r[0]) continue;
    existingMap.set(r[0], { rowIndex: i + 2, values: r });
  }

  // Upsert
  for (const [id, row] of desiredMap.entries()) {
    if (existingMap.has(id)) {
      const ex = existingMap.get(id);
      // shallow compare
      let equal = true;
      for (let i = 0; i < row.length; i++) if (ex.values[i] !== row[i]) { equal = false; break; }
      if (!equal) sheet.getRange(ex.rowIndex, 1, 1, row.length).setValues([row]);
    } else {
      sheet.appendRow(row);
    }
  }

  // Delete removed
  const toDelete = [];
  for (const [id, ex] of existingMap.entries()) if (!desiredMap.has(id)) toDelete.push(ex.rowIndex);
  toDelete.sort((a,b) => b - a).forEach(r => sheet.deleteRow(r));
}
