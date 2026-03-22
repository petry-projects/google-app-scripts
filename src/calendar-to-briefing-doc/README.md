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

1. **Deploy** using the [browser deploy page](../../deploy/index.html) — sign in, check "Calendar to Briefing Doc", configure in Step 3, and click Deploy
2. The deploy page lets you:
   - **Pick calendars** — multi-select which of your Google Calendars to include
   - **Set recipient email** — defaults to your signed-in Google account
   - **Choose schedule** — weekly (pick a day) or every N days, plus the hour
   - **Set look-ahead days** — how far ahead to scan (3–30 days)
   - **Customize email subject**
3. Click **Deploy**, then open the script and run `setup()` to activate the trigger
4. For manual setup: copy `code.gs` and `config.gs` into a new Apps Script project and edit `config.gs`

## Configuration

Edit `config.gs`:

```javascript
var BRIEFING_CONFIGS = [
  {
    useAllCalendars: true, // include all accessible calendars (default)
    excludeCalendars: [], // calendar IDs to skip (e.g. holiday calendars)
    selectedCalendars: [], // calendar IDs to include (empty = all)
    emailRecipients: ['you@example.com'], // required — who receives the briefing
    emailSubject: 'Weekly Briefing', // email subject line
    lookaheadDays: 7, // days ahead to include (default: 7)
  },
]
```

### Config fields

| Field               | Required | Default             | Description                                                                |
| ------------------- | -------- | ------------------- | -------------------------------------------------------------------------- |
| `useAllCalendars`   | ❌       | `false`             | When `true`, enumerates all accessible calendars                           |
| `excludeCalendars`  | ❌       | `[]`                | Calendar IDs to skip (only used with `useAllCalendars`)                    |
| `selectedCalendars` | ❌       | `[]`                | Calendar IDs to include (empty = all; only used with `useAllCalendars`)    |
| `calendarId`        | ❌       | —                   | Google Calendar ID for single-calendar mode (ignored if `useAllCalendars`) |
| `emailRecipients`   | ✅       | —                   | Email addresses to send the briefing to                                    |
| `emailSubject`      | ❌       | `'Weekly Briefing'` | Subject line for the briefing email                                        |
| `lookaheadDays`     | ❌       | `7`                 | Number of days ahead to include                                            |

## Required OAuth Scopes

| Scope                                               | Purpose              |
| --------------------------------------------------- | -------------------- |
| `https://www.googleapis.com/auth/calendar.readonly` | Read calendar events |
| `https://www.googleapis.com/auth/gmail.send`        | Send briefing email  |

## Trigger

The deploy page generates a `setup.gs` file with your chosen schedule (weekly or every N days). After deploying, run `setup()` once in the Apps Script editor to activate the trigger.

To change the schedule later:

1. Open **Triggers** (clock icon) in the Apps Script editor
2. Delete the existing trigger
3. Add a new trigger: `generateWeeklyBriefing` → Time-driven → choose your preferred cadence

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
