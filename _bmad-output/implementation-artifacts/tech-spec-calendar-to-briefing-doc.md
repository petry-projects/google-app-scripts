---
title: 'Calendar to Briefing Doc — Weekly Calendar Briefing Generator'
slug: 'calendar-to-briefing-doc'
created: '2026-03-21'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Google Apps Script', 'JavaScript', 'Jest', 'Playwright']
files_to_modify:
  - 'src/calendar-to-briefing-doc/code.gs'
  - 'src/calendar-to-briefing-doc/config.gs'
  - 'src/calendar-to-briefing-doc/src/index.js'
  - 'src/calendar-to-briefing-doc/tests/index.test.js'
  - 'src/calendar-to-briefing-doc/README.md'
  - 'src/deploy/index.js'
  - 'deploy/index.html'
  - 'test-utils/mocks.js'
code_patterns:
  ['dependency-injection', 'dual-layer GAS/Node', 'idempotent doc rewrite']
test_patterns:
  ['mock GAS globals', 'injected formatTime/getDateKey', 'test-utils helpers']
---

# Tech-Spec: Calendar to Briefing Doc — Weekly Calendar Briefing Generator

**Created:** 2026-03-21

## Overview

### Problem Statement

Each Sunday or Monday morning, many professionals and parents need to understand and plan the week ahead. The calendar app can be crowded and annoying to navigate. An executive-style briefing with identification of potential conflicts, delivered as a Google Doc with optional email notification, helps users plan without manually sifting through their calendar.

### Solution

A Google Apps Script that enumerates ALL calendars the user can access, fetches upcoming events, groups them by day, formats them with times/locations/attendees/descriptions (showing which calendar an event comes from if not the user's primary), writes them to a Google Doc (idempotently), and optionally emails a link to configured recipients.

### Scope

**In Scope:**

- Core script: `code.gs` (GAS entry point), `config.gs` (user config), `src/index.js` (testable logic)
- Auto-enumerate all accessible calendars (owned + subscribed)
- Show calendar source label on events from non-primary calendars
- Identify and flag potential time conflicts between events
- Group events by day with formatted day labels
- Format events with title, time/all-day, location, attendees, description
- Idempotent doc clear-and-rewrite on each run
- Optional email notification with doc link
- 40+ Jest tests covering all functions
- Deploy catalog integration (UI + server-side)
- Test infrastructure (calendar event, document, gmail mocks)
- README with setup guide

**Out of Scope:**

- Rich HTML formatting in the doc
- Recurring event deduplication
- Calendar write-back or RSVP
- Multi-language support

## Context for Development

### Codebase Patterns

- **Dual-layer architecture**: `code.gs` contains GAS-specific entry points; all testable logic extracted to `src/index.js` with `module.exports`
- **Dependency injection**: GAS globals (`CalendarApp`, `DocumentApp`, `GmailApp`) are never imported — they are passed as function parameters so tests can inject mocks
- **CommonJS only**: `require`/`module.exports` throughout — no ESM
- **No semicolons**: Prettier enforces this project-wide
- **Config separation**: All IDs, labels, and settings live in `config.gs`
- **Test mocks**: Shared in `test-utils/mocks.js` with `installGlobals`/`resetAll` lifecycle

### Files to Reference

| File                                               | Purpose                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| `src/calendar-to-briefing-doc/code.gs`             | GAS entry point — `generateWeeklyBriefing()` trigger function       |
| `src/calendar-to-briefing-doc/config.gs`           | `BRIEFING_CONFIGS` — user-editable configuration                    |
| `src/calendar-to-briefing-doc/src/index.js`        | Pure testable logic — all core functions                            |
| `src/calendar-to-briefing-doc/tests/index.test.js` | Jest test suite (40 tests)                                          |
| `src/calendar-to-briefing-doc/README.md`           | Setup guide, config reference, output format                        |
| `src/deploy/index.js`                              | Server-side deploy catalog entry                                    |
| `deploy/index.html`                                | Browser deploy UI catalog entry                                     |
| `test-utils/mocks.js`                              | Shared GAS mocks (calendar, document, gmail)                        |
| `test-utils/setup.js`                              | Jest global setup — installs mocks, provides `Utilities.formatDate` |

### Technical Decisions

- **Doc is cleared and rewritten each run** — idempotent, never grows unbounded
- **All-day events** show "All day" instead of a time range
- **Days with no events** are omitted from output
- **Email is optional** — skipped when `emailRecipients` is empty or absent
- **Error handling in `code.gs`** wraps each config entry in try-catch, logs errors, continues to next

### Investigation Findings (Step 2)

**Current architecture anchor points:**

| Function                      | File                  | Line    | Enhancement Impact                                                           |
| ----------------------------- | --------------------- | ------- | ---------------------------------------------------------------------------- |
| `generateWeeklyBriefing()`    | `code.gs`             | 121-198 | Must add `CalendarApp.getAllCalendars()` loop, merge events across calendars |
| `generateBriefingForConfig()` | `src/index.js`        | 161-197 | Change `calendar` param to `calendars` array; pass calendar names through    |
| `fetchEvents()`               | `src/index.js`        | 13-15   | Iterate multiple calendars, tag each event with source calendar name         |
| `formatEventEntry()`          | `src/index.js`        | 76-100  | Add `calendarName` parameter; show label for non-primary calendars           |
| `groupEventsByDay()`          | `src/index.js`        | 25-33   | Events must become `{event, calendarName}` tuples to preserve source         |
| `writeBriefingDoc()`          | `src/index.js`        | 114-133 | Add conflict warnings after day headings                                     |
| `BRIEFING_CONFIGS`            | `config.gs`           | 18-26   | Add `useAllCalendars` boolean; make `calendarId` optional                    |
| `CalendarApp` mock            | `test-utils/mocks.js` | 420-423 | Add `getAllCalendars()`, `getName()` on calendar objects                     |
| `createCalendar()`            | `test-utils/mocks.js` | 247-263 | Add `getName()` method returning calendar name                               |

**New functions needed:**

- `detectConflicts(events)` in `src/index.js` — given a day's events, return pairs of overlapping time ranges
- `fetchAllCalendarEvents(calendarApp, start, end)` in `src/index.js` — enumerate calendars, fetch events, return `{event, calendarName}` tuples
- `formatConflictWarning(conflicts)` in `src/index.js` — format conflict pairs for doc output

**No precedent in repo** for auto-enumeration (`calendar-to-sheets` also uses explicit `calendarId`). This will be a new pattern.

**Config structure evolution:**

```javascript
// Current:
{ calendarId: 'primary', docId: '...', ... }

// Enhanced:
{ useAllCalendars: true, docId: '...', excludeCalendars: [], ... }
// OR legacy single-calendar mode:
{ calendarId: 'specific-id', docId: '...', ... }
```

## Implementation Plan

### Tasks

Tasks are ordered by dependency (lowest level first). The existing implementation is the baseline — tasks describe only the enhancement delta.

- [ ] Task 1: Add `getName()` to calendar mock and `getAllCalendars()` to CalendarApp mock
  - File: `test-utils/mocks.js`
  - Action: Add `name` parameter to `createCalendar(id, name)` with `getName()` method. Add a calendar registry to `installGlobals` so `CalendarApp` exposes `getAllCalendars()` returning all registered calendars, `getDefaultCalendar()` returning the primary, and `getCalendarById(id)` doing lookup. Add `__addCalendar(cal)` and `__resetCalendars()` test helpers.
  - Notes: Existing tests use `createCalendar('primary')` — ensure backward compatibility by defaulting `name` to `id`.

- [ ] Task 2: Add `fetchAllCalendarEvents()` to `src/index.js`
  - File: `src/calendar-to-briefing-doc/src/index.js`
  - Action: Add new function `fetchAllCalendarEvents(calendars, defaultCalendarId, start, end)` that iterates an array of calendar objects, calls `fetchEvents()` on each, and returns an array of `{ event, calendarName }` tuples. `calendarName` is `null` for events from the calendar matching `defaultCalendarId` (the user's primary), and `calendar.getName()` for all others.
  - Notes: Reuses existing `fetchEvents()` internally. Export via `module.exports`.

- [ ] Task 3: Add `detectConflicts()` to `src/index.js`
  - File: `src/calendar-to-briefing-doc/src/index.js`
  - Action: Add new function `detectConflicts(eventTuples)` that accepts an array of `{ event, calendarName }` tuples for a single day. Returns an array of conflict objects `{ a: { title, calendarName, start, end }, b: { title, calendarName, start, end } }` where two non-all-day events have overlapping time ranges (a.start < b.end && b.start < a.end). All-day events are excluded from conflict detection.
  - Notes: O(n^2) comparison is acceptable — a day rarely has more than ~20 events. Sort by start time first for deterministic output.

- [ ] Task 4: Add `formatConflictWarning()` to `src/index.js`
  - File: `src/calendar-to-briefing-doc/src/index.js`
  - Action: Add new function `formatConflictWarning(conflicts, formatTime)` that returns a string like `"⚠️ Conflicts: \"Team Standup\" (9:00 AM–9:30 AM) overlaps with \"1:1 with Manager\" (9:15 AM–9:45 AM)"`. Returns empty string if no conflicts. Multiple conflicts are newline-separated.
  - Notes: Include calendar name in parentheses if non-null: `"Team Standup (Work)" overlaps with ...`

- [ ] Task 5: Update `groupEventsByDay()` to accept `{ event, calendarName }` tuples
  - File: `src/calendar-to-briefing-doc/src/index.js`
  - Action: Change `groupEventsByDay(events, getDateKey)` to accept either plain events or `{ event, calendarName }` tuples. If items have an `event` property, use `item.event.getStartTime()` for the date key; otherwise use `item.getStartTime()` (backward compat). The Map values become arrays of tuples.
  - Notes: This is a backward-compatible change — existing callers passing plain events still work.

- [ ] Task 6: Update `formatEventEntry()` to accept optional `calendarName`
  - File: `src/calendar-to-briefing-doc/src/index.js`
  - Action: Change signature to `formatEventEntry(event, formatTime, calendarName)`. When `calendarName` is truthy, append `📅 {calendarName}` line after the title line.
  - Notes: Third parameter is optional — existing callers without it still work.

- [ ] Task 7: Update `writeBriefingDoc()` to include conflict warnings and calendar names
  - File: `src/calendar-to-briefing-doc/src/index.js`
  - Action: After writing each day heading, call `detectConflicts()` on that day's event tuples. If conflicts exist, write a conflict warning paragraph (italic or bold) before the events. When iterating events, pass `calendarName` to `formatEventEntry()`.
  - Notes: Conflict warning appears between the day heading and the first event for that day.

- [ ] Task 8: Update `generateBriefingForConfig()` to support multi-calendar mode
  - File: `src/calendar-to-briefing-doc/src/index.js`
  - Action: Change signature to accept `calendarApp` (the CalendarApp global) instead of a single `calendar`. Add `config.useAllCalendars` branch: if true, call `calendarApp.getAllCalendars()` and pass result to `fetchAllCalendarEvents()`; if false, use legacy single-calendar path with `calendarApp.getCalendarById(config.calendarId)`. Pass `calendarApp.getDefaultCalendar().getId()` as the `defaultCalendarId`.
  - Notes: Backward compatible — `useAllCalendars: false` (or absent) behaves exactly as before.

- [ ] Task 9: Update `config.gs` with new configuration fields
  - File: `src/calendar-to-briefing-doc/config.gs`
  - Action: Add `useAllCalendars: true` (default), `excludeCalendars: []` (optional array of calendar IDs to skip), and update comments. Keep `calendarId` as optional for legacy single-calendar mode.
  - Notes: Default to `useAllCalendars: true` so new users get the full experience out of the box.

- [ ] Task 10: Update `code.gs` GAS entry point for multi-calendar flow
  - File: `src/calendar-to-briefing-doc/code.gs`
  - Action: Update `generateWeeklyBriefing()` to mirror the logic from Task 8 using GAS-native APIs. When `cfg.useAllCalendars` is true: call `CalendarApp.getAllCalendars()`, filter out `cfg.excludeCalendars`, fetch events from each, tag with `calendar.getName()`, and group/write with conflict detection. Update `_formatEventEntryGAS_()` and `_writeBriefingDocGAS_()` to handle calendar names and conflicts inline.
  - Notes: This is the GAS-native mirror of the `src/index.js` changes. Keep both implementations in sync.

- [ ] Task 11: Write tests for all new and modified functions
  - File: `src/calendar-to-briefing-doc/tests/index.test.js`
  - Action: Add test groups:
    - `fetchAllCalendarEvents`: 3 calendars with events, primary events have null calendarName, non-primary have calendar name
    - `detectConflicts`: no conflicts, two overlapping events, all-day excluded, three-way overlap, adjacent events (not overlapping)
    - `formatConflictWarning`: single conflict, multiple conflicts, empty list, conflict with calendar names
    - `groupEventsByDay` (updated): tuple input, backward compat with plain events
    - `formatEventEntry` (updated): with calendarName, without calendarName (backward compat)
    - `writeBriefingDoc` (updated): events with conflict warning, events without conflicts, mixed calendar names
    - `generateBriefingForConfig` (updated): useAllCalendars=true flow, legacy calendarId flow, excludeCalendars filtering
    - `code.gs` section: GAS versions of conflict detection and multi-calendar flow
  - Notes: Target ~20-25 new tests. Ensure coverage thresholds remain met (99% lines, 95% statements, 95% functions, 85% branches).

- [ ] Task 12: Update README with new features and config reference
  - File: `src/calendar-to-briefing-doc/README.md`
  - Action: Document `useAllCalendars`, `excludeCalendars` config fields. Update output format example to show calendar source labels and conflict warnings. Add new OAuth scope note if needed (calendar.readonly covers `getAllCalendars()`).
  - Notes: No new scopes needed — `calendar.readonly` already grants read access to all accessible calendars.

- [ ] Task 13: Update deploy catalog description
  - File: `src/deploy/index.js`, `deploy/index.html`
  - Action: Update the `description` string for the `calendar-to-briefing-doc` entry to mention multi-calendar support and conflict detection.
  - Notes: Cosmetic only — no functional deploy changes needed.

### Acceptance Criteria

**Multi-calendar enumeration:**

- [ ] AC 1: Given `useAllCalendars: true` in config, when `generateBriefingForConfig()` runs, then events from ALL accessible calendars are included in the briefing doc.
- [ ] AC 2: Given `useAllCalendars: true` and `excludeCalendars: ['holidays@group.v.calendar.google.com']`, when events are fetched, then events from the excluded calendar are omitted.
- [ ] AC 3: Given `useAllCalendars` is absent or false and `calendarId` is set, when the function runs, then only events from that single calendar are fetched (legacy behavior preserved).

**Calendar source labels:**

- [ ] AC 4: Given an event from a non-primary calendar named "Work", when formatted for the doc, then the output includes `📅 Work` after the title.
- [ ] AC 5: Given an event from the user's primary/default calendar, when formatted for the doc, then no calendar label is shown.

**Conflict detection:**

- [ ] AC 6: Given two events on the same day with overlapping times (e.g., 9:00-10:00 and 9:30-10:30), when the day is written to the doc, then a conflict warning appears after the day heading: `"⚠️ Conflicts: \"Event A\" (9:00 AM–10:00 AM) overlaps with \"Event B\" (9:30 AM–10:30 AM)"`.
- [ ] AC 7: Given two events on the same day with adjacent but non-overlapping times (e.g., 9:00-10:00 and 10:00-11:00), when the day is written, then no conflict warning appears.
- [ ] AC 8: Given an all-day event and a timed event on the same day, when conflicts are checked, then the all-day event is excluded from conflict detection.
- [ ] AC 9: Given a day with no overlapping events, when the day is written, then no conflict warning appears.

**Backward compatibility:**

- [ ] AC 10: Given a config with `calendarId: 'primary'` and no `useAllCalendars` field, when the function runs, then behavior is identical to the pre-enhancement version.
- [ ] AC 11: Given existing tests for single-calendar mode, when the test suite runs after enhancements, then all 40 original tests still pass.

**Test coverage:**

- [ ] AC 12: Given the full test suite, when `npm test -- --coverage` runs, then coverage meets thresholds: 99% lines, 95% statements, 95% functions, 85% branches.

**GAS parity:**

- [ ] AC 13: Given `code.gs` GAS implementation and `src/index.js` Node implementation, when the same inputs are provided, then both produce equivalent output (calendar names, conflict warnings, event formatting).

## Additional Context

### Dependencies

- `@types/google-apps-script` for type-checking GAS APIs — already present, no changes needed
- `test-utils/mocks.js` for shared test infrastructure — requires Task 1 enhancements
- Deploy page (`deploy/index.html`) for user-facing installation — cosmetic update only
- **GAS API dependency**: `CalendarApp.getAllCalendars()` returns all calendars the user can see (owned, subscribed, other people's). This is a read-only call covered by the existing `calendar.readonly` scope.

### Testing Strategy

**Unit tests (Jest):**

- ~20-25 new tests across 7 test groups (see Task 11)
- All new functions tested in isolation with injected mocks
- Backward compatibility verified for all modified function signatures
- Edge cases: empty calendar list, single calendar (no label), all events are all-day (no conflicts possible), 3+ overlapping events

**Integration points:**

- `code.gs` GAS functions tested via existing mock infrastructure (global CalendarApp/DocumentApp/GmailApp)
- Deploy catalog entries verified by existing Playwright E2E test (checkbox count)

**Manual testing steps:**

1. Deploy to a test Google account with 3+ calendars
2. Verify briefing doc shows events from all calendars
3. Verify primary calendar events have no label, others show calendar name
4. Create overlapping events across calendars, verify conflict warning
5. Set `excludeCalendars` with one calendar ID, verify its events are omitted
6. Remove `useAllCalendars` from config, verify legacy single-calendar behavior

### Notes

- **High-risk item**: `CalendarApp.getAllCalendars()` may return a large number of calendars for users subscribed to many shared calendars (e.g., room resources). The `excludeCalendars` config field mitigates this, but the briefing could be very long. Consider adding a `maxCalendars` safeguard in a future iteration.
- **Known limitation**: Conflict detection is per-day only. An event ending at 11:59 PM and another starting at 12:01 AM the next day won't be flagged, even though they're practically adjacent.
- **Future consideration** (out of scope): Color-coding events by calendar in the doc (requires Google Docs API v1, not available in basic DocumentApp).
- **Retroactive spec**: This spec documents an existing implementation in PR #58 and layers three enhancements on top. The existing 40 tests serve as a regression safety net.
