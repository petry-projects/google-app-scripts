# calendar-to-briefing-doc

A Google Apps Script that generates a human-readable weekly briefing Google Doc from your calendar events, grouped by day. Optionally emails the briefing link to a configured recipient list.

This complements [`calendar-to-sheets`](../calendar-to-sheets/README.md), which syncs events into a structured spreadsheet. This script takes the same calendar data and produces a narrative document — useful for planning, delegation, and as a source document for tools like NotebookLM.

## Features

- **Weekly briefing doc** — events grouped by day, sorted by start time
- **Rich event details** — title, time range, location, attendees, description
- **All-day events** — displayed as "All day" (no time range)
- **Idempotent** — the doc is cleared and rewritten on each run; it never grows unbounded
- **Optional email** — send the doc link to any number of recipients via Gmail
- **Multiple calendars** — configure multiple `BRIEFING_CONFIGS` entries to produce separate docs per calendar

## Setup

1. **Deploy** using the [browser deploy page](../../deploy/index.html) or manually create a new Google Apps Script project
2. Copy `code.gs` and `config.gs` into the project
3. In `config.gs`, fill in your `calendarId` and `docId` (and optionally `emailRecipients`)
4. Run `setup()` from the Script Editor to install a weekly time-driven trigger (set to fire every Monday at your preferred hour)
5. Run `generateWeeklyBriefing()` manually once to verify the output

## Configuration

Edit `config.gs`:

```javascript
var BRIEFING_CONFIGS = [
  {
    calendarId: 'primary', // or 'your-email@domain.com'
    docId: 'YOUR_GOOGLE_DOC_ID', // ID of the doc to overwrite each week
    lookaheadDays: 7, // days ahead to include (default: 7)
    emailRecipients: ['you@example.com'], // leave empty [] to skip email
    emailSubject: 'Weekly Briefing', // email subject line
  },
]
```

### Config fields

| Field             | Required | Default             | Description                                    |
| ----------------- | -------- | ------------------- | ---------------------------------------------- |
| `calendarId`      | ✅       | —                   | Google Calendar ID (`'primary'` or full email) |
| `docId`           | ✅       | —                   | Google Doc ID to overwrite each week           |
| `lookaheadDays`   | ❌       | `7`                 | Number of days ahead to include                |
| `emailRecipients` | ❌       | `[]`                | Email addresses to notify; empty skips email   |
| `emailSubject`    | ❌       | `'Weekly Briefing'` | Subject line for notification email            |

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
  Sprint Planning
  9:00 AM – 10:00 AM
  📍 Conference Room A
  👥 alice@example.com, bob@example.com
  Q1 roadmap review and sprint kickoff.

Tuesday, January 14
  1:1 with Manager
  3:00 PM – 3:30 PM
```
