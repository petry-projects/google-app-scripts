# calendar-to-briefing-doc

A Google Apps Script that generates a human-readable weekly briefing from your calendar events, grouped by day, and emails it directly to configured recipients.

This complements [`calendar-to-sheets`](../calendar-to-sheets/README.md), which syncs events into a structured spreadsheet. This script takes the same calendar data and produces a narrative briefing delivered by email — useful for planning, delegation, and as a source document for tools like NotebookLM.

## Features

- **All calendars at once** — automatically enumerates every calendar you can access (owned + subscribed) and merges events into a single briefing
- **Calendar source labels** — events from non-primary calendars show a 📅 label so you know which calendar they come from
- **Conflict detection** — overlapping events are flagged with a ⚠️ warning after the day heading
- **Email delivery** — the briefing is emailed directly to configured recipients as the email body
- **Rich event details** — title, time range, location, attendees, description
- **All-day events** — displayed as "All day" (no time range)
- **Legacy single-calendar mode** — set `calendarId` instead of `useAllCalendars` to pull from one calendar only

## Setup

1. **Deploy** using the [browser deploy page](../../deploy/index.html):
   - **Step 1**: Sign in with Google
   - **Step 2**: Check "Calendar to Briefing Doc" and click Deploy
   - **Step 3**: Click Configure to set calendars, email, schedule, and look-ahead
   - Click "Save Configuration", then run `setup()` in the Apps Script editor
2. The deploy page auto-detects previously deployed scripts via the Drive API
3. Version detection shows when updates are available
4. For manual setup: copy `code.gs` and `config.gs` into a new Apps Script project and edit `config.gs`

## Configuration

Edit `config.gs`:

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

### Config fields

| Field                  | Required | Default             | Description                                   |
| ---------------------- | -------- | ------------------- | --------------------------------------------- |
| `useAllCalendars`      | ❌       | `false`             | When `true`, include all accessible calendars |
| `excludeCalendars`     | ❌       | `[]`                | Calendar IDs to skip                          |
| `calendarId`           | ❌       | —                   | Single calendar ID (legacy mode)              |
| `emailRecipients`      | ✅       | —                   | Email addresses to send briefing to           |
| `emailSubject`         | ❌       | `'Weekly Briefing'` | Email subject line                            |
| `lookaheadDays`        | ❌       | `7`                 | Days ahead to include                         |
| `scheduleFrequency`    | ❌       | `'weekly'`          | `'weekly'` or `'days'`                        |
| `scheduleDay`          | ❌       | `'MONDAY'`          | Day of week (weekly mode)                     |
| `scheduleHour`         | ❌       | `7`                 | Hour to send (0–23)                           |
| `scheduleIntervalDays` | ❌       | `1`                 | Interval for every-N-days mode                |

## Required OAuth Scopes

| Scope                                               | Purpose              |
| --------------------------------------------------- | -------------------- |
| `https://www.googleapis.com/auth/calendar.readonly` | Read calendar events |
| `https://www.googleapis.com/auth/gmail.send`        | Send briefing email  |

## Trigger

The script runs on an **hourly trigger** and checks the schedule config each
hour to decide whether to send. After deploying and configuring, run `setup()`
once in the Apps Script editor to activate the hourly trigger.

To change the schedule: edit the `scheduleFrequency`, `scheduleDay`, and
`scheduleHour` fields in `config.gs` (or use the deploy page's Configure form).

## Output format

The briefing is sent as the email body:

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
