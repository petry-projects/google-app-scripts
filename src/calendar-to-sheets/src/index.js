/**
 * Calendar to Sheets utilities.
 *
 * Designed to be testable outside of Google Apps Script by accepting
 * calendar and sheet objects that match the minimal interfaces used.
 */

function eventToRow(event) {
  const id = event.getId();
  const title = event.getTitle();
  const start = event.getStartTime().toISOString();
  const end = event.getEndTime().toISOString();
  const description = event.getDescription() || '';
  const location = event.getLocation() || '';
  const attendees = (event.getGuestList() || []).map(g => g.getEmail()).join(',');
  return [id, title, start, end, description, location, attendees];
}

function rowsToMap(rows) {
  // rows is array of arrays where first col is id
  const m = new Map();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[0]) continue;
    m.set(r[0], { rowIndex: i + 2, values: r }); // assume header at row 1
  }
  return m;
}

function rowsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

async function syncCalendarToSheet(calendar, sheet, { start = new Date(0), end = new Date(Date.now() + 365*24*60*60*1000) } = {}) {
  // Fetch events
  const events = calendar.getEvents(start, end);
  const desired = events.map(eventToRow);
  const desiredMap = new Map(desired.map(r => [r[0], r]));

  // Read existing rows
  const data = sheet.getDataRange().getValues();
  const header = data[0] || [];
  const body = data.slice(1);
  const existingMap = rowsToMap(body);

  // Upsert
  for (const [id, row] of desiredMap.entries()) {
    if (existingMap.has(id)) {
      const ex = existingMap.get(id);
      if (!rowsEqual(ex.values, row)) {
        // update
        const rowIndex = ex.rowIndex;
        sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
      }
    } else {
      sheet.appendRow(row);
    }
  }

  // Delete rows for events that no longer exist
  const toDelete = [];
  for (const [id, ex] of existingMap.entries()) {
    if (!desiredMap.has(id)) toDelete.push(ex.rowIndex);
  }
  // delete from bottom to top
  toDelete.sort((a,b) => b - a).forEach(r => sheet.deleteRow(r));
}

module.exports = { eventToRow, syncCalendarToSheet, rowsEqual, rowsToMap };
