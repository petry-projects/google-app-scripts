/**
 * Calendar to Sheets utilities.
 *
 * Designed to be testable outside of Google Apps Script by accepting
 * calendar and sheet objects that match the minimal interfaces used.
 */

function sanitizeValue(val) {
  // Prevent formula injection by prefixing formula metacharacters with '
  if (typeof val === 'string' && /^[=+\-@]/.test(val)) {
    return "'" + val;
  }
  return val;
}

function eventToRow(event) {
  const id = event.getId();
  const title = sanitizeValue(event.getTitle());
  const start = event.getStartTime().toISOString();
  const end = event.getEndTime().toISOString();
  const description = sanitizeValue(event.getDescription() || '');
  const location = sanitizeValue(event.getLocation() || '');
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
  // Compare only the first row.length columns (ignoring extra cols in b)
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) if (a[i] !== b[i]) return false;
  // If lengths differ, they're only equal if extra columns are all falsy/empty
  if (a.length !== b.length) {
    const longer = a.length > b.length ? a : b;
    for (let i = Math.max(a.length, b.length) === a.length ? b.length : a.length; i < longer.length; i++) {
      if (longer[i]) return false;
    }
  }
  return true;
}

async function syncCalendarToSheet(calendar, sheet, { start = new Date(0), end = new Date(Date.now() + 365*24*60*60*1000) } = {}) {
  // Fetch events
  const events = calendar.getEvents(start, end);
  const desired = events.map(eventToRow);
  const desiredMap = new Map(desired.map(r => [r[0], r]));

  // Read existing rows
  const data = sheet.getDataRange().getValues();
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

  // Delete rows for events that no longer exist, but only if they fall within
  // the synced time window to avoid deleting rows from events outside [start,end]
  const toDelete = [];
  for (const [id, ex] of existingMap.entries()) {
    if (!desiredMap.has(id)) {
      // Only delete if the row has start/end columns and falls within [start,end]
      // Otherwise, preserve historical rows outside the sync window
      const rowStart = ex.values[2]; // start is at index 2
      const rowEnd = ex.values[3];   // end is at index 3
      if (rowStart && rowEnd) {
        const rowStartTime = new Date(rowStart);
        const rowEndTime = new Date(rowEnd);
        // Only delete if row's event time falls within our sync window
        if (rowStartTime >= start && rowStartTime <= end) {
          toDelete.push(ex.rowIndex);
        }
      } else {
        // If no valid date columns, don't delete (preserve historical data)
      }
    }
  }
  // delete from bottom to top
  toDelete.sort((a,b) => b - a).forEach(r => sheet.deleteRow(r));
}

module.exports = { eventToRow, syncCalendarToSheet, rowsEqual, rowsToMap };
