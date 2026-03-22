---
title: 'Calendar to Briefing Doc — Weekly Calendar Briefing Email'
slug: 'calendar-to-briefing-doc'
created: '2026-03-21'
updated: '2026-03-22'
status: 'implemented'
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
  ['dependency-injection', 'dual-layer GAS/Node', 'schedule-in-config']
test_patterns:
  ['mock GAS globals', 'injected formatTime/getDateKey', 'test-utils helpers']
---

# Tech-Spec: Calendar to Briefing Doc — Weekly Calendar Briefing Email

**Created:** 2026-03-21 | **Updated:** 2026-03-22

## Overview

### Problem Statement

Each Sunday or Monday morning, many professionals and parents need to understand
and plan the week ahead. The calendar app can be crowded and annoying to
navigate. An executive-style briefing with identification of potential conflicts,
delivered as an email, helps users plan without manually sifting through their
calendar.

### Solution

A Google Apps Script that enumerates all calendars the user can access, fetches
upcoming events, groups them by day, formats them with
times/locations/attendees/descriptions (showing which calendar each event comes
from if not the user's primary), detects time conflicts, and emails the briefing
directly to configured recipients.

The script runs on an hourly trigger and uses config-based schedule fields to
determine when to actually send (weekly on a specific day, or every N days).

## Architecture

### Dual-Layer Design

- **`code.gs`** — GAS-native entry point with inline logic, deployed to Apps
  Script. Contains `// @version X.Y.Z` tag for version detection.
- **`src/index.js`** — Pure Node.js testable core with dependency injection.
  All business logic extracted here; GAS globals injected as parameters.
- **`config.gs`** — User-editable configuration (schedule, email, calendars).
- **`tests/index.test.js`** — Jest tests covering all functions in both layers.

### Key Functions

| Function                      | Layer      | Purpose                                                               |
| ----------------------------- | ---------- | --------------------------------------------------------------------- |
| `fetchEvents()`               | `index.js` | Fetches events from a single calendar                                 |
| `fetchAllCalendarEvents()`    | `index.js` | Enumerates multiple calendars, returns `{event, calendarName}` tuples |
| `groupEventsByDay()`          | `index.js` | Groups events/tuples by date key into sorted Map                      |
| `formatDayLabel()`            | `index.js` | Converts `YYYY-MM-DD` → `Monday, January 13`                          |
| `formatEventEntry()`          | `index.js` | Formats one event as text block (title, time, location, etc.)         |
| `detectConflicts()`           | `index.js` | Finds overlapping time ranges among events for a day                  |
| `formatConflictWarning()`     | `index.js` | Formats conflict pairs as ⚠️ warning text                             |
| `formatBriefing()`            | `index.js` | Assembles full briefing as plain text string                          |
| `emailBriefing()`             | `index.js` | Sends email to each recipient via GmailApp                            |
| `shouldRunNow()`              | `index.js` | Schedule check — returns true if now matches configured schedule      |
| `generateBriefingForConfig()` | `index.js` | Orchestrates full flow for one config entry                           |
| `generateWeeklyBriefing()`    | `code.gs`  | Main trigger function — iterates configs, checks schedule, sends      |

### Schedule-in-Config Pattern

The script runs on an **hourly trigger** (`setup.gs` creates `everyHours(1)`).
Each hour, `generateWeeklyBriefing()` calls `shouldRunNow()` to check whether
the current time matches the config's schedule. This avoids the need to
programmatically configure GAS triggers (which can't be done via the API).

Schedule config fields:

- `scheduleFrequency`: `'weekly'` or `'days'`
- `scheduleDay`: `'MONDAY'` through `'SUNDAY'` (for weekly)
- `scheduleHour`: `0`–`23`
- `scheduleIntervalDays`: number (for every-N-days mode)

`PropertiesService` stores the last run timestamp per config to prevent
duplicate sends and to track elapsed time for the every-N-days mode.

## Config Fields

```javascript
var BRIEFING_CONFIGS = [
  {
    useAllCalendars: true,
    excludeCalendars: [],
    emailRecipients: ['you@example.com'],
    emailSubject: 'Weekly Briefing',
    lookaheadDays: 7,
    scheduleFrequency: 'weekly',
    scheduleDay: 'MONDAY',
    scheduleHour: 7,
  },
]
```

| Field                  | Required | Default             | Description                                 |
| ---------------------- | -------- | ------------------- | ------------------------------------------- |
| `useAllCalendars`      | No       | `false`             | When true, include all accessible calendars |
| `excludeCalendars`     | No       | `[]`                | Calendar IDs to skip                        |
| `calendarId`           | No       | —                   | Single calendar ID (legacy mode)            |
| `emailRecipients`      | **Yes**  | —                   | Email addresses to send briefing to         |
| `emailSubject`         | No       | `'Weekly Briefing'` | Email subject line                          |
| `lookaheadDays`        | No       | `7`                 | Days ahead to include                       |
| `scheduleFrequency`    | No       | `'weekly'`          | `'weekly'` or `'days'`                      |
| `scheduleDay`          | No       | `'MONDAY'`          | Day of week for weekly mode                 |
| `scheduleHour`         | No       | `7`                 | Hour (0–23) to send                         |
| `scheduleIntervalDays` | No       | `1`                 | Interval for every-N-days mode              |

## OAuth Scopes

| Scope                                               | Purpose              |
| --------------------------------------------------- | -------------------- |
| `https://www.googleapis.com/auth/calendar.readonly` | Read calendar events |
| `https://www.googleapis.com/auth/gmail.send`        | Send briefing email  |

## Output Format

The briefing is sent as the email body (plain text):

```
Weekly Briefing: Monday, January 13 – Sunday, January 19

Monday, January 13
⚠️ "Sprint Planning" (9:00 AM–10:00 AM) overlaps with "Design Review" (9:30 AM–10:30 AM)

Sprint Planning
9:00 AM – 10:00 AM
📍 Conference Room A
👥 alice@example.com, bob@example.com

Design Review
📅 Design Team
9:30 AM – 10:30 AM

Tuesday, January 14
1:1 with Manager
3:00 PM – 3:30 PM

Soccer Practice
📅 Family
5:00 PM – 6:30 PM
```

## Test Coverage

- **291 unit tests** (68 for this script) across `src/index.js` and `code.gs`
- **Coverage**: 98.90% statements, 89.87% branches, 97.98% functions
- Key test groups: fetchAllCalendarEvents, detectConflicts, formatConflictWarning,
  shouldRunNow, formatBriefing, generateBriefingForConfig, code.gs GAS parity
