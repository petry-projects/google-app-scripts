/**
 * GAS wrapper for Calendar to Sheets.
 *
 * Place configuration in `config.gs` using `SYNC_CONFIGS` (preferred) or the legacy
 * `SPREADSHEET_ID`/`SHEET_NAME`/`CALENDAR_ID` vars for a single mapping.
 * This file is primarily a wrapper that can run in Google Apps Script.
 * 
 * Checkpoint logic prevents reprocessing very old events (>1 year) to avoid timeouts.
 */

const CHECKPOINT_PREFIX = 'calendar_to_sheets_last_sync_';
const DEFAULT_SYNC_WINDOW_MS = 365 * 24 * 60 * 60 * 1000; // 1 year in milliseconds
// Backward-compatible alias; prefer DEFAULT_SYNC_WINDOW_MS in new code.
const MIN_EVENT_AGE_MS = DEFAULT_SYNC_WINDOW_MS;

function getConfigs() {
  if (typeof SYNC_CONFIGS !== 'undefined' && Array.isArray(SYNC_CONFIGS)) return SYNC_CONFIGS;
  // Legacy single-config support
  return [
    {
      spreadsheetId: typeof SPREADSHEET_ID !== 'undefined' ? SPREADSHEET_ID : null,
      sheetName: typeof SHEET_NAME !== 'undefined' ? SHEET_NAME : 'Sheet1',
      calendarId: typeof CALENDAR_ID !== 'undefined' ? CALENDAR_ID : null
    }
  ];
}

function getConfig() {
  const cfgs = getConfigs();
  return cfgs[0] || null;
}

/**
 * Get the checkpoint key for a given config.
 * Used to store/retrieve last sync timestamp for a calendar.
 */
function getCheckpointKey(cfg) {
  return CHECKPOINT_PREFIX + (cfg.calendarId || 'default');
}

/**
 * Load the last sync timestamp from properties storage.
 * If never synced, defaults to epoch (scan all history on first run).
 */
function getLastSyncTime(cfg) {
  const key = getCheckpointKey(cfg);
  const stored = PropertiesService.getUserProperties().getProperty(key);
  if (stored) {
    return new Date(parseInt(stored));
  }
  // Default: epoch (January 1, 1970) to sync all events on first run
  return new Date(0);
}

/**
 * Save the current sync timestamp to properties storage.
 */
function saveLastSyncTime(cfg, timestamp) {
  const key = getCheckpointKey(cfg);
  PropertiesService.getUserProperties().setProperty(key, timestamp.getTime().toString());
}

/**
 * Clear checkpoint for a calendar (useful for full re-sync).
 */
function clearCheckpoint(cfg) {
  const key = getCheckpointKey(cfg);
  PropertiesService.getUserProperties().deleteProperty(key);
}

/**
 * Sanitize a value to prevent formula injection in spreadsheets.
 * If a string starts with =, +, -, or @, prefix it with a single quote
 * to force it to be treated as literal text rather than a formula.
 */
function sanitizeValue(val) {
  if (typeof val === 'string' && /^[=+\-@]/.test(val)) {
    return "'" + val;
  }
  return val;
}

function eventToRowGAS(event) {
  const id = event.getId();
  const title = sanitizeValue(event.getTitle());
  const start = event.getStartTime().toISOString();
  const end = event.getEndTime().toISOString();
  const description = sanitizeValue(event.getDescription() || '');
  const location = sanitizeValue(event.getLocation() || '');
  const attendees = (event.getGuestList() || []).map(g => g.getEmail()).join(',');
  return [id, title, start, end, description, location, attendees];
}

function _syncCalendarToSheetGAS(cfg, start, end) {
  const calendar = cfg && cfg.calendarId ? CalendarApp.getCalendarById(cfg.calendarId) : CalendarApp.getDefaultCalendar();
  const ss = cfg && cfg.spreadsheetId ? SpreadsheetApp.openById(cfg.spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(cfg && cfg.sheetName ? cfg.sheetName : 'Sheet1') || ss.getSheets()[0];

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

function syncCalendarToSheetGAS(startIso, endIso) {
  const cfg = getConfig();
  let start = startIso ? new Date(startIso) : getLastSyncTime(cfg);
  const end = endIso ? new Date(endIso) : new Date(Date.now() + 365*24*60*60*1000);
  
  const result = _syncCalendarToSheetGAS(cfg, start, end);
  
  // Update checkpoint after successful sync
  saveLastSyncTime(cfg, end);
  return result;
}

function syncAllCalendarsToSheetsGAS(startIso, endIso) {
  const cfgs = getConfigs();
  for (let i = 0; i < cfgs.length; i++) {
    try {
      let start = startIso ? new Date(startIso) : getLastSyncTime(cfgs[i]);
      const end = endIso ? new Date(endIso) : new Date(Date.now() + 365*24*60*60*1000);
      _syncCalendarToSheetGAS(cfgs[i], start, end);

      // Update checkpoint after successful sync
      saveLastSyncTime(cfgs[i], end);
    } catch (e) {
      // Log and continue with other calendars; do not advance checkpoint on failure
      if (typeof Logger !== 'undefined' && Logger.log) {
        Logger.log('Error syncing calendar "' + (cfgs[i].calendarId || 'default') + '": ' + e);
      }
    }
  }
}

/**
 * Resync within a limited window: clears checkpoint and syncs from ~1 year ago.
 * This avoids timeout issues with very large calendars while still capturing
 * recent deletions and updates. To resync the full calendar history, manually
 * set start = new Date(0) before calling _syncCalendarToSheetGAS.
 * Use sparingly as it may cause performance issues with large calendars.
 */
function fullResyncCalendarToSheetGAS(configIndex) {
  const cfgs = getConfigs();
  const cfg = cfgs[configIndex || 0];
  clearCheckpoint(cfg);
  const start = new Date(Date.now() - MIN_EVENT_AGE_MS);
  const end = new Date(Date.now() + 365*24*60*60*1000);
  _syncCalendarToSheetGAS(cfg, start, end);
  saveLastSyncTime(cfg, end);
}

// Export for testing in Node environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getConfigs, getConfig, eventToRowGAS, sanitizeValue, syncCalendarToSheetGAS, syncAllCalendarsToSheetsGAS, getLastSyncTime, saveLastSyncTime, clearCheckpoint, getCheckpointKey, fullResyncCalendarToSheetGAS };
}
