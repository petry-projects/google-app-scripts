# calendar-to-sheets

Google Apps Script that syncs events from a user's primary Google Calendar into a Google Sheet.

Features:
- Writes full event details (id, title, start, end, description, location, attendees) into a sheet row.
- Updates existing rows when an event changes (no duplicates).
- Removes rows when events are deleted from the calendar.

Testing & development
- Unit tests are implemented with Jest. Run `npm test` from the repo root.
- Tests are designed to run locally using the repository's `test-utils` mocks.

Usage
- The runnable Apps Script entry points live in `code.gs` and configuration values are in `config.gs`.
- Configuration now supports multiple calendar->sheet mappings via `SYNC_CONFIGS` in `config.gs` (preferred). Legacy single mapping using `SPREADSHEET_ID`, `SHEET_NAME`, and `CALENDAR_ID` is still supported.
- Use the GAS wrapper `syncCalendarToSheetGAS(startIso, endIso)` for a single mapping (legacy behavior) or `syncAllCalendarsToSheetsGAS(startIso, endIso)` to sync all mappings defined in `SYNC_CONFIGS`. Both functions accept optional `startIso`/`endIso` ISO timestamps.
- The core, testable logic lives under `src/` (`eventToRow`, `syncCalendarToSheet`, etc.) and is exercised by the included Jest tests.
- To deploy: copy `code.gs` and `config.gs` into your Apps Script project or import their contents into the script editor, then schedule `syncCalendarToSheetGAS` as a trigger or run it manually.

