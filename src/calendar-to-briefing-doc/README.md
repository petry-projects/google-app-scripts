# calendar-to-briefing-doc

A Google Apps Script that generates a human-readable weekly briefing Google Doc from your calendar events, grouped by day. Optionally emails the briefing link to a configured recipient list.

This complements [`calendar-to-sheets`](../calendar-to-sheets/README.md), which syncs events into a structured spreadsheet. This script takes the same calendar data and produces a narrative document — useful for planning, delegation, and as a source document for tools like NotebookLM.

## Features

- **All calendars at once** — automatically enumerates every calendar you can access (owned + subscribed) and merges events into a single briefing
- **Calendar source labels** — events from non-primary calendars show a 📅 label so you know which calendar they come from
- **Conflict detection** — overlapping events are flagged with a ⚠️ warning after the day heading
- **Weekly briefing doc** — events grouped by day, sorted by start time
- **Rich event details** — title, time range, location, attendees, description
- **All-day events** — displayed as "All day" (no time range)
- **Idempotent** — the doc is cleared and rewritten on each run; it never grows unbounded
- **Optional email** — send the doc link to any number of recipients via Gmail
- **Legacy single-calendar mode** — set `calendarId` instead of `useAllCalendars` to pull from one calendar only

## Setup

1. **Deploy** using the [browser deploy page](../../deploy/index.html) or manually create a new Google Apps Script project
2. Copy `code.gs` and `config.gs` into the project
3. In `config.gs`, fill in your `docId` (and optionally `emailRecipients`). By default all calendars are included; set `calendarId` instead of `useAllCalendars` for a single calendar
4. The deploy page installs an **hourly** trigger for `generateWeeklyBriefing`. For a true weekly cadence, see the **Trigger** section below to replace it with a weekly trigger
5. Run `generateWeeklyBriefing()` manually once to verify the output

## Configuration

Edit `config.gs`:

```javascript
var BRIEFING_CONFIGS = [
  {
    useAllCalendars: true, // include all accessible calendars (default)
    excludeCalendars: [], // calendar IDs to skip (e.g. holiday calendars)
    docId: 'YOUR_GOOGLE_DOC_ID', // ID of the doc to overwrite each week
    lookaheadDays: 7, // days ahead to include (default: 7)
    emailRecipients: ['you@example.com'], // leave empty [] to skip email
    emailSubject: 'Weekly Briefing', // email subject line
  },
]
```

### Config fields

| Field               | Required | Default             | Description                                                            |
| ------------------- | -------- | ------------------- | ---------------------------------------------------------------------- |
| `useAllCalendars`   | ❌       | `false`             | When `true`, enumerates all accessible calendars                       |
| `excludeCalendars`  | ❌       | `[]`                | Calendar IDs to skip (only used with `useAllCalendars`)                |
| `calendarId`        | ❌       | —                   | Google Calendar ID for single-calendar mode (ignored if `useAllCalendars`) |
| `docId`             | ✅       | —                   | Google Doc ID to overwrite each week                                   |
| `lookaheadDays`     | ❌       | `7`                 | Number of days ahead to include                                        |
| `emailRecipients`   | ❌       | `[]`                | Email addresses to notify; empty skips email                           |
| `emailSubject`      | ❌       | `'Weekly Briefing'` | Subject line for notification email                                    |

## Required OAuth Scopes

| Scope                                               | Purpose                            |
| --------------------------------------------------- | ---------------------------------- |
| `https://www.googleapis.com/auth/calendar.readonly` | Read calendar events               |
| `https://www.googleapis.com/auth/documents`         | Write to Google Doc                |
| `https://www.googleapis.com/auth/gmail.send`        | Send notification email (optional) |

## Trigger

The deploy page installs an **hourly** trigger for `generateWeeklyBriefing`. For a true weekly cadence, replace it with a time-based weekly trigger in the Apps Script editor:

1. Open **Triggers** (clock icon) in the Apps Script editor
2. Delete the hourly trigger
3. Add a new trigger: `generateWeeklyBriefing` → Time-driven → Week timer → Every Monday at your preferred hour

## Output format

```
Weekly Briefing: Monday, January 13 – Sunday, January 19

Monday, January 13
  ⚠️ "Sprint Planning" (9:00 AM–10:00 AM) overlaps with "Design Review" (9:30 AM–10:30 AM)

  Sprint Planning
  9:00 AM – 10:00 AM
  📍 Conference Room A
  👥 alice@example.com, bob@example.com
  Q1 roadmap review and sprint kickoff.

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
