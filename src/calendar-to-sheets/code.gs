/**
 * GAS wrapper for Calendar to Sheets.
 *
 * Place configuration in `config.gs` using `SYNC_CONFIGS` (preferred) or the legacy
 * `SPREADSHEET_ID`/`SHEET_NAME`/`CALENDAR_ID` vars for a single mapping.
 * This file is primarily a wrapper that can run in Google Apps Script.
 * 
 * Checkpoint logic processes data in chunks to work around timeouts found in personal GAS plans.
 */

const CHECKPOINT_PREFIX = 'calendar_to_sheets_last_sync_';
const DEFAULT_SYNC_WINDOW_MS = 365 * 24 * 60 * 60 * 1000; // 1 year in milliseconds
const TAIL_MERGE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes


function getConfigs() {
  if (typeof SYNC_CONFIGS !== 'undefined' && Array.isArray(SYNC_CONFIGS)) {
    // If SYNC_CONFIGS is an empty array, fall back to legacy mode
    if (SYNC_CONFIGS.length === 0) {
      return [
        {
          spreadsheetId: typeof SPREADSHEET_ID !== 'undefined' ? SPREADSHEET_ID : null,
          sheetName: typeof SHEET_NAME !== 'undefined' ? SHEET_NAME : 'Sheet1',
          calendarId: typeof CALENDAR_ID !== 'undefined' ? CALENDAR_ID : null
        }
      ];
    }
    return SYNC_CONFIGS;
  }
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
  return CHECKPOINT_PREFIX + ((cfg && cfg.calendarId) || 'default');
}

/**
 * Load the last sync timestamp from properties storage.
 * If never synced, defaults to epoch.
 * If the stored checkpoint is invalid (NaN or corrupt), resets to epoch.
 */
function getLastSyncTime(cfg) {
  const key = getCheckpointKey(cfg);
  const stored = PropertiesService.getUserProperties().getProperty(key);
  // Check if a value exists (null means no property set)
  if (stored !== null && stored !== undefined) {
    const parsedTime = parseInt(stored);
    // Validate the parsed timestamp
    if (isNaN(parsedTime)) {
      console.log('[getLastSyncTime] Invalid checkpoint detected (NaN), resetting to epoch');
      return new Date(0);
    }
    const date = new Date(parsedTime);
    // Check if the date is valid (not Invalid Date)
    if (isNaN(date.getTime())) {
      console.log('[getLastSyncTime] Invalid checkpoint detected (Invalid Date), resetting to epoch');
      return new Date(0);
    }
    return date;
  }

  // Default to epoch if no checkpoint exists
  const defaultStart = new Date(0);
  console.log('[getLastSyncTime] Defaulting to epoch:', defaultStart.toISOString());
  return defaultStart;
}

/**
 * Save the current sync timestamp to properties storage.
 */
function saveLastSyncTime(cfg, timestamp) {
  const key = getCheckpointKey(cfg);
  console.log('[saveLastSyncTime] Saving checkpoint for calendar:', cfg?.calendarId || 'default', 'timestamp:', timestamp.toISOString());
  PropertiesService.getUserProperties().setProperty(key, timestamp.getTime().toString());
  console.log('[saveLastSyncTime] Checkpoint saved with key:', key);
}

/**
 * Clear checkpoint for a calendar (useful for full re-sync).
 */
function clearCheckpoint(cfg) {
  const key = getCheckpointKey(cfg);
  console.log('[clearCheckpoint] Clearing checkpoint for calendar:', cfg?.calendarId || 'default');
  PropertiesService.getUserProperties().deleteProperty(key);
  console.log('[clearCheckpoint] Checkpoint cleared with key:', key);
}

/**
 * Sanitize a value to prevent formula injection in spreadsheets.
 * If a string effectively starts with =, +, -, or @ (ignoring leading
 * whitespace/control characters), prefix it with a single quote
 * to force it to be treated as literal text rather than a formula.
 */
function sanitizeValue(val) {
  if (typeof val === 'string' && /^[\x00-\x20]*[=+\-@]/.test(val)) {
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

function getOrCreateSheet(ss, sheetName) {
  const resolvedName = sheetName || 'Sheet1';
  let sheet = ss.getSheetByName(resolvedName);
  if (!sheet && typeof ss.insertSheet === 'function') {
    sheet = ss.insertSheet(resolvedName);
  }
  return sheet || ss.getSheets()[0];
}

function _syncCalendarToSheetGAS(cfg, start, end) {
  console.log('[_syncCalendarToSheetGAS] Starting sync with config:', { calendarId: cfg?.calendarId, spreadsheetId: cfg?.spreadsheetId, sheetName: cfg?.sheetName });
  console.log('[_syncCalendarToSheetGAS] Date range:', { start, end });
  
  const calendar = cfg && cfg.calendarId ? CalendarApp.getCalendarById(cfg.calendarId) : CalendarApp.getDefaultCalendar();
  const ss = cfg && cfg.spreadsheetId ? SpreadsheetApp.openById(cfg.spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, cfg && cfg.sheetName ? cfg.sheetName : 'Sheet1');

  const events = calendar.getEvents(start, end);
  console.log('[_syncCalendarToSheetGAS] Fetched events:', events.length);
  const desired = events.map(eventToRowGAS);
  const desiredMap = new Map(desired.map(r => [r[0], r]));

  // Ensure the header row exists before reading data so the first event
  // row is never mistaken for a header on a brand-new/empty sheet.
  if (typeof ensureHeader === 'function') {
    ensureHeader(sheet);
  }
  let data = sheet.getDataRange().getValues();
  // Ensure header row exists; if sheet is empty or first row is blank, create headers.
  if (!data || data.length === 0 || (data.length === 1 && data[0].every(function (cell) { return cell === '' || cell === null; }))) {
    // Header titles chosen to be descriptive; they should align with eventToRowGAS's column order.
    const headerRow = [
      'Event ID',
      'Title',
      'Start',
      'End',
      'Duration (hours)',
      'All Day',
      'Created',
      'Last Updated',
      'Location',
      'Description',
      'Guests'
    ];
    sheet.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
    data = sheet.getDataRange().getValues();
  }
  const body = data.slice(1);
  console.log('[_syncCalendarToSheetGAS] Existing rows in sheet:', body.length);

  const existingMap = new Map();
  for (let i = 0; i < body.length; i++) {
    const r = body[i];
    if (!r || !r[0]) continue;
    existingMap.set(r[0], { rowIndex: i + 2, values: r });
  }

  // Upsert
  let updateCount = 0;
  let insertCount = 0;
  for (const [id, row] of desiredMap.entries()) {
    if (existingMap.has(id)) {
      const ex = existingMap.get(id);
      // shallow compare
      let equal = true;
      for (let i = 0; i < row.length; i++) if (ex.values[i] !== row[i]) { equal = false; break; }
      if (!equal) {
        console.log('[_syncCalendarToSheetGAS] Updating event:', id);
        sheet.getRange(ex.rowIndex, 1, 1, row.length).setValues([row]);
        updateCount++;
      }
    } else {
      console.log('[_syncCalendarToSheetGAS] Inserting new event:', id);
      sheet.appendRow(row);
      insertCount++;
    }
  }
  console.log('[_syncCalendarToSheetGAS] Updates:', updateCount, 'Inserts:', insertCount);

  // Delete removed events that fall within the sync window [start, end]
  // This prevents wiping historical events outside the current sync range.
  const toDelete = [];
  for (const [id, ex] of existingMap.entries()) {
    if (!desiredMap.has(id)) {
      // Only delete if the event's start time falls within the sync window
      const eventStart = ex.values[2] ? new Date(ex.values[2]) : null;
      if (eventStart && eventStart >= start && eventStart <= end) {
        toDelete.push(ex.rowIndex);
      }
    }
  }
  console.log('[_syncCalendarToSheetGAS] Deleting rows:', toDelete.length);
  toDelete.sort((a,b) => b - a).forEach(r => sheet.deleteRow(r));
  console.log('[_syncCalendarToSheetGAS] Sync complete');
}

function syncCalendarToSheetGAS(startIso, endIso) {
  const cfg = getConfig();
  const checkpoint = getLastSyncTime(cfg);
  const now = new Date();
  let start = startIso ? new Date(startIso) : checkpoint;
  const end = endIso ? new Date(endIso) : now;

  // Validate: if checkpoint is in the future, reset it
  if (start > end) {
    console.log('[syncCalendarToSheetGAS] Warning: start time is after end time, resetting checkpoint');
    clearCheckpoint(cfg);
    start = getLastSyncTime(cfg);
  }

  if (startIso && (now.getTime() - start.getTime()) <= DEFAULT_SYNC_WINDOW_MS) {
    start = new Date(start.getTime() - DEFAULT_SYNC_WINDOW_MS);
  }
  
  
  // Sync in chunks to prevent timeouts
  // After each chunk, checkpoint progress so we can resume if interrupted
  let currentStart = start;
  let iterationCount = 0;
  const maxIterations = 100; // Safety limit to prevent infinite loops
  
  while (currentStart < end && iterationCount < maxIterations) {
    // Calculate the end of this chunk (SYNC_WINDOW from current start, but not beyond target end)
    const chunkEnd = new Date(currentStart.getTime() + DEFAULT_SYNC_WINDOW_MS);
    let effectiveEnd = chunkEnd < end ? chunkEnd : end;
    if (chunkEnd < end && (end.getTime() - chunkEnd.getTime()) <= TAIL_MERGE_WINDOW_MS) {
      effectiveEnd = end;
    }
    
    console.log('[syncCalendarToSheetGAS] Syncing chunk:', { start: currentStart.toISOString(), end: effectiveEnd.toISOString() });
    
    _syncCalendarToSheetGAS(cfg, currentStart, effectiveEnd);
    
    // Checkpoint after each successful chunk
    saveLastSyncTime(cfg, effectiveEnd);
    console.log('[syncCalendarToSheetGAS] Checkpointed:', effectiveEnd.toISOString());
    
    // Move to next chunk
    currentStart = effectiveEnd;
    iterationCount++;
  }
  
  if (iterationCount >= maxIterations) {
    console.log('[syncCalendarToSheetGAS] Warning: reached maximum iteration limit');
  }
}

function syncAllCalendarsToSheetsGAS(startIso, endIso) {
  const cfgs = getConfigs();
  for (let i = 0; i < cfgs.length; i++) {
    try {
      const checkpoint = getLastSyncTime(cfgs[i]);
      const now = new Date();
      let start = startIso ? new Date(startIso) : checkpoint;
      const end = endIso ? new Date(endIso) : now;
      
      // Validate: if checkpoint is in the future, reset it
      if (start > end) {
        console.log('[syncAllCalendarsToSheetsGAS] Warning: start time is after end time for calendar', cfgs[i].calendarId, ', resetting checkpoint');
        clearCheckpoint(cfgs[i]);
        start = getLastSyncTime(cfgs[i]);
      }

      if ((now.getTime() - start.getTime()) <= DEFAULT_SYNC_WINDOW_MS) {
        start = new Date(start.getTime() - DEFAULT_SYNC_WINDOW_MS);
      }
      
      // Sync in 1-year chunks to prevent timeouts
      // After each chunk, checkpoint progress so we can resume if interrupted
      let currentStart = start;
      let iterationCount = 0;
      const maxIterations = 100; // Safety limit to prevent infinite loops
      
      while (currentStart < end && iterationCount < maxIterations) {
        // Calculate the end of this chunk (1 year from current start, but not beyond target end)
        const chunkEnd = new Date(currentStart.getTime() + DEFAULT_SYNC_WINDOW_MS);
        let effectiveEnd = chunkEnd < end ? chunkEnd : end;
        if (chunkEnd < end && (end.getTime() - chunkEnd.getTime()) <= TAIL_MERGE_WINDOW_MS) {
          effectiveEnd = end;
        }
        
        console.log('[syncAllCalendarsToSheetsGAS] Syncing chunk for calendar', cfgs[i].calendarId, ':', { start: currentStart.toISOString(), end: effectiveEnd.toISOString() });
        
        _syncCalendarToSheetGAS(cfgs[i], currentStart, effectiveEnd);
        
        // Checkpoint after each successful chunk
        saveLastSyncTime(cfgs[i], effectiveEnd);
        console.log('[syncAllCalendarsToSheetsGAS] Checkpointed calendar', cfgs[i].calendarId, ':', effectiveEnd.toISOString());
        
        // Move to next chunk
        currentStart = effectiveEnd;
        iterationCount++;
      }
      
      if (iterationCount >= maxIterations) {
        console.log('[syncAllCalendarsToSheetsGAS] Warning: reached maximum iteration limit for calendar', cfgs[i].calendarId);
      }
    } catch (e) {
      // Log and continue with other calendars; do not advance checkpoint on failure
      if (typeof Logger !== 'undefined' && Logger.log) {
        Logger.log('Error syncing calendar "' + ((cfgs[i] && cfgs[i].calendarId) || 'default') + '": ' + e);
      }
    }
  }
}

/**
 * Full resync: clears the sheet and checkpoint(s), then resyncs calendar(s) from the beginning of time (epoch).
 * 
 * @param {number|null} configIndex - Index of specific config to resync, or null/undefined to resync all
 * 
 * Uses chunking logic to process large date ranges in 1-year increments, preventing timeouts.
 * Checkpoints are saved after each chunk, allowing resumption if interrupted.
 */
function fullResyncCalendarToSheetGAS(configIndex) {
  const cfgs = getConfigs();
  const start = new Date(0);
  const end = new Date();
  
  // If configIndex is specified, sync only that config
  if (configIndex !== null && configIndex !== undefined) {
    const cfg = cfgs[configIndex];
    if (cfg) {
      clearCheckpoint(cfg);
      // Clear sheet content (except header) before full resync
      const ss = cfg && cfg.spreadsheetId ? SpreadsheetApp.openById(cfg.spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
      const sheet = getOrCreateSheet(ss, cfg && cfg.sheetName ? cfg.sheetName : 'Sheet1');
      const data = sheet.getDataRange().getValues();
      if (data.length > 1) {
        sheet.deleteRows(2, data.length - 1);
      }
      _syncCalendarToSheetGAS(cfg, start, end);
      saveLastSyncTime(cfg, new Date());
    }
  } else {
    // Otherwise, sync all configs
    // First loop: clear checkpoints and sheets for all configs
    for (let i = 0; i < cfgs.length; i++) {
      try {
        clearCheckpoint(cfgs[i]);
        // Clear sheet content (except header) before full resync
        const ss = cfgs[i] && cfgs[i].spreadsheetId ? SpreadsheetApp.openById(cfgs[i].spreadsheetId) : SpreadsheetApp.getActiveSpreadsheet();
        const sheet = getOrCreateSheet(ss, cfgs[i] && cfgs[i].sheetName ? cfgs[i].sheetName : 'Sheet1');
        const data = sheet.getDataRange().getValues();
        if (data.length > 1) {
          sheet.deleteRows(2, data.length - 1);
        }
      } catch (e) {
        if (typeof Logger !== 'undefined' && Logger.log) {
          Logger.log('Error clearing calendar "' + ((cfgs[i] && cfgs[i].calendarId) || 'default') + '": ' + e);
        }
      }
    }
    // Use syncAllCalendarsToSheetsGAS which handles chunking and error handling
    syncAllCalendarsToSheetsGAS(start.toISOString(), end.toISOString());
  }
}

// Export for testing in Node environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getConfigs, getConfig, eventToRowGAS, sanitizeValue, syncCalendarToSheetGAS, syncAllCalendarsToSheetsGAS, getLastSyncTime, saveLastSyncTime, clearCheckpoint, getCheckpointKey, fullResyncCalendarToSheetGAS };
}
