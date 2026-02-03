/**
 * Calendar to Sheets configuration.
 * Supports multiple calendar-to-sheet mappings.
 * Update values when deploying in Google Apps Script.
 *
 * Legacy single-mapping variables (`SPREADSHEET_ID`, `SHEET_NAME`, `CALENDAR_ID`) are still
 * supported for backwards compatibility, but `SYNC_CONFIGS` is preferred.
 *
 * Example:
 * var SYNC_CONFIGS = [
 *   { spreadsheetId: 'aSpreadsheetId', sheetName: 'Sheet1', calendarId: 'aCalendarId' },
 *   { spreadsheetId: 'anotherSpreadsheetId', sheetName: 'Sheet2', calendarId: 'anotherCalendarId' }
 * ];
 */

var SYNC_CONFIGS = [
  { spreadsheetId: '', sheetName: 'Sheet1', calendarId: '' }
];