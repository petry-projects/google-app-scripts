const {
  installGlobals,
  resetAll,
  createCalendarEvent,
  createCalendar,
} = require('../../../test-utils/mocks')
const {
  fetchEvents,
  fetchAllCalendarEvents,
  detectConflicts,
  formatConflictWarning,
  groupEventsByDay,
  formatDayLabel,
  formatEventEntry,
  formatBriefing,
  emailBriefing,
  shouldRunNow,
  generateBriefingForConfig,
} = require('../src/index')

// Simple date-key helper that works with UTC dates (mirrors GAS Utilities.formatDate)
function testDateKey(date) {
  const d = new Date(date)
  return d.toISOString().slice(0, 10)
}

// Simple time formatter for tests
function testFormatTime(date) {
  const d = new Date(date)
  const h = d.getUTCHours()
  const m = d.getUTCMinutes()
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

beforeEach(() => installGlobals(global))
afterEach(() => resetAll(global))

// ── fetchEvents ───────────────────────────────────────────────────────────────

describe('fetchEvents', () => {
  it('delegates to calendar.getEvents', () => {
    const start = new Date('2025-01-13T00:00:00Z')
    const end = new Date('2025-01-20T00:00:00Z')
    const evt = createCalendarEvent({ id: 'e1', title: 'Test', start, end })
    CalendarApp.getDefaultCalendar().__addEvent(evt)

    const calendar = CalendarApp.getCalendarById('primary')
    const events = fetchEvents(calendar, start, end)
    expect(events).toHaveLength(1)
    expect(events[0].getTitle()).toBe('Test')
  })
})

// ── groupEventsByDay ──────────────────────────────────────────────────────────

describe('groupEventsByDay', () => {
  it('returns empty map for no events', () => {
    const grouped = groupEventsByDay([], testDateKey)
    expect(grouped.size).toBe(0)
  })

  it('groups events on the same day together', () => {
    const day = '2025-01-13T00:00:00Z'
    const e1 = createCalendarEvent({
      id: 'e1',
      title: 'Morning',
      start: new Date(day),
      end: new Date(day),
    })
    const e2 = createCalendarEvent({
      id: 'e2',
      title: 'Afternoon',
      start: new Date('2025-01-13T14:00:00Z'),
      end: new Date('2025-01-13T15:00:00Z'),
    })

    const grouped = groupEventsByDay([e1, e2], testDateKey)
    expect(grouped.size).toBe(1)
    expect(grouped.get('2025-01-13')).toHaveLength(2)
  })

  it('separates events on different days', () => {
    const e1 = createCalendarEvent({
      id: 'e1',
      title: 'Mon',
      start: new Date('2025-01-13T09:00:00Z'),
      end: new Date('2025-01-13T10:00:00Z'),
    })
    const e2 = createCalendarEvent({
      id: 'e2',
      title: 'Tue',
      start: new Date('2025-01-14T09:00:00Z'),
      end: new Date('2025-01-14T10:00:00Z'),
    })

    const grouped = groupEventsByDay([e1, e2], testDateKey)
    expect(grouped.size).toBe(2)
    expect([...grouped.keys()]).toEqual(['2025-01-13', '2025-01-14'])
  })

  it('sorts days ascending (oldest first)', () => {
    const e1 = createCalendarEvent({
      id: 'e1',
      start: new Date('2025-01-15T09:00:00Z'),
      end: new Date('2025-01-15T10:00:00Z'),
    })
    const e2 = createCalendarEvent({
      id: 'e2',
      start: new Date('2025-01-13T09:00:00Z'),
      end: new Date('2025-01-13T10:00:00Z'),
    })

    const grouped = groupEventsByDay([e1, e2], testDateKey)
    expect([...grouped.keys()]).toEqual(['2025-01-13', '2025-01-15'])
  })
})

// ── formatDayLabel ────────────────────────────────────────────────────────────

describe('formatDayLabel', () => {
  it('formats a Monday correctly', () => {
    expect(formatDayLabel('2025-01-13')).toBe('Monday, January 13')
  })

  it('formats a Saturday in December correctly', () => {
    expect(formatDayLabel('2025-12-27')).toBe('Saturday, December 27')
  })

  it('formats a Sunday in February correctly', () => {
    expect(formatDayLabel('2025-02-02')).toBe('Sunday, February 2')
  })
})

// ── formatEventEntry ──────────────────────────────────────────────────────────

describe('formatEventEntry', () => {
  it('formats a basic timed event', () => {
    const evt = createCalendarEvent({
      id: 'e1',
      title: 'Standup',
      start: new Date('2025-01-13T15:00:00Z'),
      end: new Date('2025-01-13T15:30:00Z'),
    })
    const text = formatEventEntry(evt, testFormatTime)
    expect(text).toContain('Standup')
    expect(text).toContain('3:00 PM')
    expect(text).toContain('3:30 PM')
  })

  it('formats an all-day event', () => {
    const evt = createCalendarEvent({
      id: 'e2',
      title: 'Holiday',
      start: new Date('2025-01-20T00:00:00Z'),
      end: new Date('2025-01-20T00:00:00Z'),
      allDay: true,
    })
    const text = formatEventEntry(evt, testFormatTime)
    expect(text).toContain('Holiday')
    expect(text).toContain('All day')
    expect(text).not.toContain('AM')
    expect(text).not.toContain('PM')
  })

  it('includes location when present', () => {
    const evt = createCalendarEvent({
      id: 'e3',
      title: 'Meeting',
      start: new Date('2025-01-13T10:00:00Z'),
      end: new Date('2025-01-13T11:00:00Z'),
      location: 'Room 42',
    })
    const text = formatEventEntry(evt, testFormatTime)
    expect(text).toContain('Room 42')
  })

  it('omits location section when empty', () => {
    const evt = createCalendarEvent({
      id: 'e4',
      title: 'Solo',
      start: new Date('2025-01-13T10:00:00Z'),
      end: new Date('2025-01-13T11:00:00Z'),
    })
    const text = formatEventEntry(evt, testFormatTime)
    expect(text).not.toContain('\uD83D\uDCCD')
  })

  it('includes attendees when present', () => {
    const evt = createCalendarEvent({
      id: 'e5',
      title: 'Sync',
      start: new Date('2025-01-13T10:00:00Z'),
      end: new Date('2025-01-13T11:00:00Z'),
      attendees: ['alice@example.com', 'bob@example.com'],
    })
    const text = formatEventEntry(evt, testFormatTime)
    expect(text).toContain('alice@example.com')
    expect(text).toContain('bob@example.com')
  })

  it('includes description when present', () => {
    const evt = createCalendarEvent({
      id: 'e6',
      title: 'Review',
      start: new Date('2025-01-13T10:00:00Z'),
      end: new Date('2025-01-13T11:00:00Z'),
      description: 'Quarterly review discussion.',
    })
    const text = formatEventEntry(evt, testFormatTime)
    expect(text).toContain('Quarterly review discussion.')
  })

  it('uses "(No Title)" for events with empty title', () => {
    const evt = createCalendarEvent({
      id: 'e7',
      title: '',
      start: new Date('2025-01-13T10:00:00Z'),
      end: new Date('2025-01-13T11:00:00Z'),
    })
    const text = formatEventEntry(evt, testFormatTime)
    expect(text).toContain('(No Title)')
  })
})

// ── formatBriefing ──────────────────────────────────────────────────────────

describe('formatBriefing', () => {
  it('returns title only for empty groupedEvents', () => {
    const text = formatBriefing('Empty Briefing', new Map(), testFormatTime)
    expect(text).toBe('Empty Briefing')
  })

  it('formats a single day with one event', () => {
    const e1 = createCalendarEvent({
      id: 'e1',
      title: 'Standup',
      start: new Date('2025-01-13T15:00:00Z'),
      end: new Date('2025-01-13T15:30:00Z'),
    })
    const grouped = new Map([['2025-01-13', [e1]]])
    const text = formatBriefing('Weekly Briefing', grouped, testFormatTime)
    expect(text).toContain('Weekly Briefing')
    expect(text).toContain('Monday, January 13')
    expect(text).toContain('Standup')
    expect(text).toContain('3:00 PM')
  })

  it('formats multiple days in ascending order', () => {
    const e1 = createCalendarEvent({
      id: 'e1',
      title: 'Monday Event',
      start: new Date('2025-01-13T09:00:00Z'),
      end: new Date('2025-01-13T10:00:00Z'),
    })
    const e2 = createCalendarEvent({
      id: 'e2',
      title: 'Tuesday Event',
      start: new Date('2025-01-14T09:00:00Z'),
      end: new Date('2025-01-14T10:00:00Z'),
    })
    const grouped = groupEventsByDay([e1, e2], testDateKey)
    const text = formatBriefing('Briefing', grouped, testFormatTime)
    const monIdx = text.indexOf('Monday, January 13')
    const tueIdx = text.indexOf('Tuesday, January 14')
    expect(monIdx).toBeLessThan(tueIdx)
  })

  it('sorts events within a day by start time', () => {
    const late = createCalendarEvent({
      id: 'e1',
      title: 'Afternoon',
      start: new Date('2025-01-13T14:00:00Z'),
      end: new Date('2025-01-13T15:00:00Z'),
    })
    const early = createCalendarEvent({
      id: 'e2',
      title: 'Morning',
      start: new Date('2025-01-13T09:00:00Z'),
      end: new Date('2025-01-13T10:00:00Z'),
    })
    const grouped = new Map([['2025-01-13', [late, early]]])
    const text = formatBriefing('Briefing', grouped, testFormatTime)
    const morningIdx = text.indexOf('Morning')
    const afternoonIdx = text.indexOf('Afternoon')
    expect(morningIdx).toBeLessThan(afternoonIdx)
  })

  it('includes conflict warnings when events overlap', () => {
    const tuples = [
      {
        event: createCalendarEvent({
          id: 'e1',
          title: 'Meeting A',
          start: new Date('2025-01-13T09:00:00Z'),
          end: new Date('2025-01-13T10:00:00Z'),
        }),
        calendarName: null,
      },
      {
        event: createCalendarEvent({
          id: 'e2',
          title: 'Meeting B',
          start: new Date('2025-01-13T09:30:00Z'),
          end: new Date('2025-01-13T10:30:00Z'),
        }),
        calendarName: 'Work',
      },
    ]
    const grouped = new Map([['2025-01-13', tuples]])
    const text = formatBriefing('Briefing', grouped, testFormatTime)
    expect(text).toContain('\u26A0\uFE0F')
    expect(text).toContain('overlaps with')
    expect(text).toContain('\uD83D\uDCC5 Work')
  })

  it('includes calendar names for non-default calendar events', () => {
    const tuples = [
      {
        event: createCalendarEvent({
          id: 'e1',
          title: 'Work Event',
          start: new Date('2025-01-13T09:00:00Z'),
          end: new Date('2025-01-13T10:00:00Z'),
        }),
        calendarName: 'Work',
      },
      {
        event: createCalendarEvent({
          id: 'e2',
          title: 'Personal',
          start: new Date('2025-01-13T11:00:00Z'),
          end: new Date('2025-01-13T12:00:00Z'),
        }),
        calendarName: null,
      },
    ]
    const grouped = new Map([['2025-01-13', tuples]])
    const text = formatBriefing('Briefing', grouped, testFormatTime)
    expect(text).toContain('\uD83D\uDCC5 Work')
    // Personal event should not have a calendar label
    const lines = text.split('\n')
    const personalIdx = lines.findIndex((l) => l === 'Personal')
    expect(personalIdx).toBeGreaterThan(-1)
    // Next line after "Personal" should be the time, not a calendar label
    expect(lines[personalIdx + 1]).not.toContain('\uD83D\uDCC5')
  })

  it('omits conflict warnings when no overlaps', () => {
    const tuples = [
      {
        event: createCalendarEvent({
          id: 'e1',
          title: 'A',
          start: new Date('2025-01-13T09:00:00Z'),
          end: new Date('2025-01-13T10:00:00Z'),
        }),
        calendarName: null,
      },
      {
        event: createCalendarEvent({
          id: 'e2',
          title: 'B',
          start: new Date('2025-01-13T10:00:00Z'),
          end: new Date('2025-01-13T11:00:00Z'),
        }),
        calendarName: null,
      },
    ]
    const grouped = new Map([['2025-01-13', tuples]])
    const text = formatBriefing('Briefing', grouped, testFormatTime)
    expect(text).not.toContain('\u26A0\uFE0F')
  })
})

// ── emailBriefing ─────────────────────────────────────────────────────────────

describe('emailBriefing', () => {
  it('sends an email to each recipient with the briefing body', () => {
    const body = 'Weekly Briefing: Monday, January 13\n\nStandup\n3:00 PM'
    emailBriefing(
      GmailApp,
      ['alice@example.com', 'bob@example.com'],
      'Weekly Briefing',
      body
    )
    const sent = GmailApp.__sentEmails
    expect(sent).toHaveLength(2)
    expect(sent[0].to).toBe('alice@example.com')
    expect(sent[0].subject).toBe('Weekly Briefing')
    expect(sent[0].body).toContain('Standup')
    expect(sent[1].to).toBe('bob@example.com')
    expect(sent[1].body).toContain('Standup')
  })

  it('is a no-op for empty recipients array', () => {
    emailBriefing(GmailApp, [], 'Subject', 'body text')
    expect(GmailApp.__sentEmails).toHaveLength(0)
  })

  it('is a no-op for null recipients', () => {
    emailBriefing(GmailApp, null, 'Subject', 'body text')
    expect(GmailApp.__sentEmails).toHaveLength(0)
  })
})

// ── shouldRunNow ─────────────────────────────────────────────────────────────

describe('shouldRunNow', () => {
  it('returns true on the configured weekly day and hour', () => {
    const config = {
      scheduleFrequency: 'weekly',
      scheduleDay: 'MONDAY',
      scheduleHour: 7,
    }
    // Monday at 7 AM
    const now = new Date('2025-01-13T07:00:00')
    expect(shouldRunNow(config, now, null)).toBe(true)
  })

  it('returns false on wrong day', () => {
    const config = {
      scheduleFrequency: 'weekly',
      scheduleDay: 'MONDAY',
      scheduleHour: 7,
    }
    // Tuesday at 7 AM
    const now = new Date('2025-01-14T07:00:00')
    expect(shouldRunNow(config, now, null)).toBe(false)
  })

  it('returns false on wrong hour', () => {
    const config = {
      scheduleFrequency: 'weekly',
      scheduleDay: 'MONDAY',
      scheduleHour: 7,
    }
    // Monday at 8 AM
    const now = new Date('2025-01-13T08:00:00')
    expect(shouldRunNow(config, now, null)).toBe(false)
  })

  it('defaults to weekly Monday 7 AM when schedule fields are missing', () => {
    const config = {}
    // Monday at 7 AM
    const now = new Date('2025-01-13T07:00:00')
    expect(shouldRunNow(config, now, null)).toBe(true)
  })

  it('returns true for every-N-days when enough time has elapsed', () => {
    const config = {
      scheduleFrequency: 'days',
      scheduleIntervalDays: 3,
      scheduleHour: 6,
    }
    const now = new Date('2025-01-16T06:00:00')
    const lastRun = new Date('2025-01-13T06:00:00').getTime()
    expect(shouldRunNow(config, now, lastRun)).toBe(true)
  })

  it('returns false for every-N-days when not enough time has elapsed', () => {
    const config = {
      scheduleFrequency: 'days',
      scheduleIntervalDays: 3,
      scheduleHour: 6,
    }
    const now = new Date('2025-01-15T06:00:00')
    const lastRun = new Date('2025-01-13T06:00:00').getTime()
    expect(shouldRunNow(config, now, lastRun)).toBe(false)
  })

  it('returns true for every-N-days on first run (no lastRun)', () => {
    const config = {
      scheduleFrequency: 'days',
      scheduleIntervalDays: 7,
      scheduleHour: 5,
    }
    const now = new Date('2025-01-13T05:00:00')
    expect(shouldRunNow(config, now, null)).toBe(true)
  })
})

// ── generateBriefingForConfig ─────────────────────────────────────────────────

describe('generateBriefingForConfig', () => {
  it('throws when emailRecipients is missing', () => {
    const config = {
      calendarId: 'primary',
      lookaheadDays: 7,
      emailRecipients: [],
    }
    expect(() =>
      generateBriefingForConfig(
        CalendarApp,
        GmailApp,
        config,
        testDateKey,
        testFormatTime
      )
    ).toThrow('emailRecipients is required')
  })

  it('sends email with briefing content to recipients', () => {
    const calendar = CalendarApp.getCalendarById('primary')
    const futureStart = new Date(Date.now() + 60 * 60 * 1000)
    const futureEnd = new Date(Date.now() + 2 * 60 * 60 * 1000)
    calendar.__addEvent(
      createCalendarEvent({
        id: 'e1',
        title: 'All Hands',
        start: futureStart,
        end: futureEnd,
      })
    )
    const config = {
      calendarId: 'primary',
      lookaheadDays: 7,
      emailRecipients: ['manager@example.com'],
      emailSubject: 'My Weekly Briefing',
    }
    generateBriefingForConfig(
      CalendarApp,
      GmailApp,
      config,
      testDateKey,
      testFormatTime
    )
    expect(GmailApp.__sentEmails).toHaveLength(1)
    expect(GmailApp.__sentEmails[0].subject).toBe('My Weekly Briefing')
    expect(GmailApp.__sentEmails[0].to).toBe('manager@example.com')
    expect(GmailApp.__sentEmails[0].body).toContain('Weekly Briefing')
    expect(GmailApp.__sentEmails[0].body).toContain('All Hands')
  })

  it('uses default email subject when emailSubject is not set', () => {
    const config = {
      calendarId: 'primary',
      lookaheadDays: 7,
      emailRecipients: ['x@example.com'],
    }
    generateBriefingForConfig(
      CalendarApp,
      GmailApp,
      config,
      testDateKey,
      testFormatTime
    )
    expect(GmailApp.__sentEmails[0].subject).toBe('Weekly Briefing')
  })

  it('uses default lookaheadDays of 7 when not specified', () => {
    const config = {
      calendarId: 'primary',
      emailRecipients: ['x@example.com'],
    }
    generateBriefingForConfig(
      CalendarApp,
      GmailApp,
      config,
      testDateKey,
      testFormatTime
    )
    expect(GmailApp.__sentEmails[0].body).toContain('Weekly Briefing')
  })
})

// ── fetchAllCalendarEvents ───────────────────────────────────────────────────

describe('fetchAllCalendarEvents', () => {
  it('returns tuples with null calendarName for default calendar', () => {
    const cal = createCalendar('primary', 'Primary')
    const evt = createCalendarEvent({
      id: 'e1',
      title: 'Test',
      start: new Date('2025-01-13T09:00:00Z'),
      end: new Date('2025-01-13T10:00:00Z'),
    })
    cal.__addEvent(evt)
    const tuples = fetchAllCalendarEvents(
      [cal],
      'primary',
      new Date('2025-01-13T00:00:00Z'),
      new Date('2025-01-20T00:00:00Z')
    )
    expect(tuples).toHaveLength(1)
    expect(tuples[0].calendarName).toBeNull()
    expect(tuples[0].event.getTitle()).toBe('Test')
  })

  it('tags non-default calendar events with calendar name', () => {
    const primary = createCalendar('primary', 'Primary')
    const work = createCalendar('work@group.calendar', 'Work')
    work.__addEvent(
      createCalendarEvent({
        id: 'e1',
        title: 'Work Meeting',
        start: new Date('2025-01-13T09:00:00Z'),
        end: new Date('2025-01-13T10:00:00Z'),
      })
    )
    const tuples = fetchAllCalendarEvents(
      [primary, work],
      'primary',
      new Date('2025-01-13T00:00:00Z'),
      new Date('2025-01-20T00:00:00Z')
    )
    expect(tuples).toHaveLength(1)
    expect(tuples[0].calendarName).toBe('Work')
  })

  it('merges events from multiple calendars', () => {
    const primary = createCalendar('primary', 'Primary')
    const work = createCalendar('work@group.calendar', 'Work')
    const family = createCalendar('family@group.calendar', 'Family')
    primary.__addEvent(
      createCalendarEvent({
        id: 'e1',
        title: 'Personal',
        start: new Date('2025-01-13T09:00:00Z'),
        end: new Date('2025-01-13T10:00:00Z'),
      })
    )
    work.__addEvent(
      createCalendarEvent({
        id: 'e2',
        title: 'Standup',
        start: new Date('2025-01-13T10:00:00Z'),
        end: new Date('2025-01-13T10:30:00Z'),
      })
    )
    family.__addEvent(
      createCalendarEvent({
        id: 'e3',
        title: 'Dinner',
        start: new Date('2025-01-13T18:00:00Z'),
        end: new Date('2025-01-13T19:00:00Z'),
      })
    )
    const tuples = fetchAllCalendarEvents(
      [primary, work, family],
      'primary',
      new Date('2025-01-13T00:00:00Z'),
      new Date('2025-01-20T00:00:00Z')
    )
    expect(tuples).toHaveLength(3)
    expect(tuples[0].calendarName).toBeNull()
    expect(tuples[1].calendarName).toBe('Work')
    expect(tuples[2].calendarName).toBe('Family')
  })

  it('excludes calendars in excludeCalendars list', () => {
    const primary = createCalendar('primary', 'Primary')
    const holidays = createCalendar('holidays@group.calendar', 'Holidays')
    holidays.__addEvent(
      createCalendarEvent({
        id: 'e1',
        title: 'Holiday',
        start: new Date('2025-01-13T00:00:00Z'),
        end: new Date('2025-01-13T00:00:00Z'),
        allDay: true,
      })
    )
    const tuples = fetchAllCalendarEvents(
      [primary, holidays],
      'primary',
      new Date('2025-01-13T00:00:00Z'),
      new Date('2025-01-20T00:00:00Z'),
      ['holidays@group.calendar']
    )
    expect(tuples).toHaveLength(0)
  })
})

// ── detectConflicts ─────────────────────────────────────────────────────────

describe('detectConflicts', () => {
  it('returns empty array when no conflicts', () => {
    const tuples = [
      {
        event: createCalendarEvent({
          id: 'e1',
          title: 'A',
          start: new Date('2025-01-13T09:00:00Z'),
          end: new Date('2025-01-13T10:00:00Z'),
        }),
        calendarName: null,
      },
      {
        event: createCalendarEvent({
          id: 'e2',
          title: 'B',
          start: new Date('2025-01-13T10:00:00Z'),
          end: new Date('2025-01-13T11:00:00Z'),
        }),
        calendarName: null,
      },
    ]
    expect(detectConflicts(tuples)).toHaveLength(0)
  })

  it('detects two overlapping events', () => {
    const tuples = [
      {
        event: createCalendarEvent({
          id: 'e1',
          title: 'Meeting A',
          start: new Date('2025-01-13T09:00:00Z'),
          end: new Date('2025-01-13T10:00:00Z'),
        }),
        calendarName: null,
      },
      {
        event: createCalendarEvent({
          id: 'e2',
          title: 'Meeting B',
          start: new Date('2025-01-13T09:30:00Z'),
          end: new Date('2025-01-13T10:30:00Z'),
        }),
        calendarName: 'Work',
      },
    ]
    const conflicts = detectConflicts(tuples)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].a.title).toBe('Meeting A')
    expect(conflicts[0].b.title).toBe('Meeting B')
    expect(conflicts[0].b.calendarName).toBe('Work')
  })

  it('excludes all-day events from conflict detection', () => {
    const tuples = [
      {
        event: createCalendarEvent({
          id: 'e1',
          title: 'Holiday',
          start: new Date('2025-01-13T00:00:00Z'),
          end: new Date('2025-01-13T00:00:00Z'),
          allDay: true,
        }),
        calendarName: null,
      },
      {
        event: createCalendarEvent({
          id: 'e2',
          title: 'Standup',
          start: new Date('2025-01-13T09:00:00Z'),
          end: new Date('2025-01-13T09:30:00Z'),
        }),
        calendarName: null,
      },
    ]
    expect(detectConflicts(tuples)).toHaveLength(0)
  })

  it('detects three-way overlap', () => {
    const tuples = [
      {
        event: createCalendarEvent({
          id: 'e1',
          title: 'A',
          start: new Date('2025-01-13T09:00:00Z'),
          end: new Date('2025-01-13T10:00:00Z'),
        }),
        calendarName: null,
      },
      {
        event: createCalendarEvent({
          id: 'e2',
          title: 'B',
          start: new Date('2025-01-13T09:15:00Z'),
          end: new Date('2025-01-13T09:45:00Z'),
        }),
        calendarName: null,
      },
      {
        event: createCalendarEvent({
          id: 'e3',
          title: 'C',
          start: new Date('2025-01-13T09:30:00Z'),
          end: new Date('2025-01-13T10:30:00Z'),
        }),
        calendarName: null,
      },
    ]
    const conflicts = detectConflicts(tuples)
    expect(conflicts).toHaveLength(3)
  })
})

// ── formatConflictWarning ───────────────────────────────────────────────────

describe('formatConflictWarning', () => {
  it('returns empty string for no conflicts', () => {
    expect(formatConflictWarning([], testFormatTime)).toBe('')
  })

  it('returns empty string for null conflicts', () => {
    expect(formatConflictWarning(null, testFormatTime)).toBe('')
  })

  it('formats a single conflict', () => {
    const conflicts = [
      {
        a: {
          title: 'Meeting A',
          calendarName: null,
          start: new Date('2025-01-13T09:00:00Z'),
          end: new Date('2025-01-13T10:00:00Z'),
        },
        b: {
          title: 'Meeting B',
          calendarName: null,
          start: new Date('2025-01-13T09:30:00Z'),
          end: new Date('2025-01-13T10:30:00Z'),
        },
      },
    ]
    const warning = formatConflictWarning(conflicts, testFormatTime)
    expect(warning).toContain('\u26A0\uFE0F')
    expect(warning).toContain('Meeting A')
    expect(warning).toContain('Meeting B')
    expect(warning).toContain('overlaps with')
  })

  it('includes calendar name when present', () => {
    const conflicts = [
      {
        a: {
          title: 'Personal',
          calendarName: null,
          start: new Date('2025-01-13T09:00:00Z'),
          end: new Date('2025-01-13T10:00:00Z'),
        },
        b: {
          title: 'Work Standup',
          calendarName: 'Work',
          start: new Date('2025-01-13T09:30:00Z'),
          end: new Date('2025-01-13T10:30:00Z'),
        },
      },
    ]
    const warning = formatConflictWarning(conflicts, testFormatTime)
    expect(warning).toContain('Work Standup (Work)')
    expect(warning).not.toContain('Personal (')
  })

  it('formats multiple conflicts with newlines', () => {
    const conflicts = [
      {
        a: {
          title: 'A',
          calendarName: null,
          start: new Date('2025-01-13T09:00:00Z'),
          end: new Date('2025-01-13T10:00:00Z'),
        },
        b: {
          title: 'B',
          calendarName: null,
          start: new Date('2025-01-13T09:30:00Z'),
          end: new Date('2025-01-13T10:30:00Z'),
        },
      },
      {
        a: {
          title: 'C',
          calendarName: null,
          start: new Date('2025-01-13T11:00:00Z'),
          end: new Date('2025-01-13T12:00:00Z'),
        },
        b: {
          title: 'D',
          calendarName: null,
          start: new Date('2025-01-13T11:30:00Z'),
          end: new Date('2025-01-13T12:30:00Z'),
        },
      },
    ]
    const warning = formatConflictWarning(conflicts, testFormatTime)
    expect(warning.split('\n')).toHaveLength(2)
  })
})

// ── formatEventEntry with calendarName ──────────────────────────────────────

describe('formatEventEntry with calendarName', () => {
  it('includes calendar label when calendarName is provided', () => {
    const evt = createCalendarEvent({
      id: 'e1',
      title: 'Work Meeting',
      start: new Date('2025-01-13T09:00:00Z'),
      end: new Date('2025-01-13T10:00:00Z'),
    })
    const text = formatEventEntry(evt, testFormatTime, 'Work')
    expect(text).toContain('\uD83D\uDCC5 Work')
  })

  it('omits calendar label when calendarName is null', () => {
    const evt = createCalendarEvent({
      id: 'e1',
      title: 'Personal',
      start: new Date('2025-01-13T09:00:00Z'),
      end: new Date('2025-01-13T10:00:00Z'),
    })
    const text = formatEventEntry(evt, testFormatTime, null)
    expect(text).not.toContain('\uD83D\uDCC5')
  })
})

// ── groupEventsByDay with tuples ────────────────────────────────────────────

describe('groupEventsByDay with tuples', () => {
  it('groups tuples by date using event.getStartTime()', () => {
    const tuples = [
      {
        event: createCalendarEvent({
          id: 'e1',
          start: new Date('2025-01-13T09:00:00Z'),
          end: new Date('2025-01-13T10:00:00Z'),
        }),
        calendarName: null,
      },
      {
        event: createCalendarEvent({
          id: 'e2',
          start: new Date('2025-01-13T14:00:00Z'),
          end: new Date('2025-01-13T15:00:00Z'),
        }),
        calendarName: 'Work',
      },
    ]
    const grouped = groupEventsByDay(tuples, (d) =>
      new Date(d).toISOString().slice(0, 10)
    )
    expect(grouped.size).toBe(1)
    expect(grouped.get('2025-01-13')).toHaveLength(2)
    expect(grouped.get('2025-01-13')[0].calendarName).toBeNull()
    expect(grouped.get('2025-01-13')[1].calendarName).toBe('Work')
  })
})

// ── generateBriefingForConfig with multi-calendar ───────────────────────────

describe('generateBriefingForConfig with multi-calendar', () => {
  it('uses all calendars when useAllCalendars is true', () => {
    const work = createCalendar('work@group.calendar', 'Work')
    const futureStart = new Date(Date.now() + 60 * 60 * 1000)
    const futureEnd = new Date(Date.now() + 2 * 60 * 60 * 1000)
    work.__addEvent(
      createCalendarEvent({
        id: 'e1',
        title: 'Work Standup',
        start: futureStart,
        end: futureEnd,
      })
    )
    CalendarApp.__addCalendar(work)
    const config = {
      useAllCalendars: true,
      lookaheadDays: 7,
      emailRecipients: ['test@example.com'],
    }
    generateBriefingForConfig(
      CalendarApp,
      GmailApp,
      config,
      testDateKey,
      testFormatTime
    )
    expect(GmailApp.__sentEmails).toHaveLength(1)
    const body = GmailApp.__sentEmails[0].body
    expect(body).toContain('Weekly Briefing')
    expect(body).toContain('\uD83D\uDCC5 Work')
  })

  it('excludes calendars in excludeCalendars', () => {
    const excluded = createCalendar('excluded@group.calendar', 'Excluded')
    const futureStart = new Date(Date.now() + 60 * 60 * 1000)
    const futureEnd = new Date(Date.now() + 2 * 60 * 60 * 1000)
    excluded.__addEvent(
      createCalendarEvent({
        id: 'e1',
        title: 'Should Not Appear',
        start: futureStart,
        end: futureEnd,
      })
    )
    CalendarApp.__addCalendar(excluded)
    const config = {
      useAllCalendars: true,
      excludeCalendars: ['excluded@group.calendar'],
      lookaheadDays: 7,
      emailRecipients: ['test@example.com'],
    }
    generateBriefingForConfig(
      CalendarApp,
      GmailApp,
      config,
      testDateKey,
      testFormatTime
    )
    const body = GmailApp.__sentEmails[0].body
    expect(body).not.toContain('Should Not Appear')
  })

  it('falls back to legacy single-calendar mode when useAllCalendars is falsy', () => {
    const calendar = CalendarApp.getCalendarById('primary')
    const futureStart = new Date(Date.now() + 60 * 60 * 1000)
    const futureEnd = new Date(Date.now() + 2 * 60 * 60 * 1000)
    calendar.__addEvent(
      createCalendarEvent({
        id: 'e1',
        title: 'Legacy Event',
        start: futureStart,
        end: futureEnd,
      })
    )
    const config = {
      calendarId: 'primary',
      lookaheadDays: 7,
      emailRecipients: ['test@example.com'],
    }
    generateBriefingForConfig(
      CalendarApp,
      GmailApp,
      config,
      testDateKey,
      testFormatTime
    )
    const body = GmailApp.__sentEmails[0].body
    expect(body).toContain('Legacy Event')
    expect(body).not.toContain('\uD83D\uDCC5')
  })
})

// ── code.gs ───────────────────────────────────────────────────────────────────

describe('code.gs', () => {
  let code

  beforeEach(() => {
    delete require.cache[require.resolve('../code.gs')]
    code = require('../code.gs')
  })

  describe('getBriefingConfigs_', () => {
    it('returns BRIEFING_CONFIGS when defined as an array', () => {
      global.BRIEFING_CONFIGS = [
        { calendarId: 'cal1', emailRecipients: ['a@b.com'] },
      ]
      delete require.cache[require.resolve('../code.gs')]
      const freshCode = require('../code.gs')
      expect(freshCode.getBriefingConfigs_()).toEqual([
        { calendarId: 'cal1', emailRecipients: ['a@b.com'] },
      ])
      delete global.BRIEFING_CONFIGS
    })

    it('returns empty array when BRIEFING_CONFIGS is not defined', () => {
      delete global.BRIEFING_CONFIGS
      delete require.cache[require.resolve('../code.gs')]
      const freshCode = require('../code.gs')
      expect(freshCode.getBriefingConfigs_()).toEqual([])
    })
  })

  describe('_formatDayLabelGAS_', () => {
    it('formats a date key correctly', () => {
      expect(code._formatDayLabelGAS_('2025-01-13')).toBe('Monday, January 13')
    })

    it('formats another date key', () => {
      expect(code._formatDayLabelGAS_('2025-07-04')).toBe('Friday, July 4')
    })
  })

  describe('_formatEventEntryGAS_', () => {
    it('formats a timed event using Utilities.formatDate', () => {
      const evt = createCalendarEvent({
        id: 'e1',
        title: 'Team Sync',
        start: new Date('2025-01-13T15:00:00Z'),
        end: new Date('2025-01-13T16:00:00Z'),
      })
      const text = code._formatEventEntryGAS_(evt, 'UTC')
      expect(text).toContain('Team Sync')
      expect(text).toContain('3:00 PM')
      expect(text).toContain('4:00 PM')
    })

    it('formats an all-day event', () => {
      const evt = createCalendarEvent({
        id: 'e2',
        title: 'Holiday',
        start: new Date('2025-01-20T00:00:00Z'),
        end: new Date('2025-01-20T00:00:00Z'),
        allDay: true,
      })
      const text = code._formatEventEntryGAS_(evt, 'UTC')
      expect(text).toContain('Holiday')
      expect(text).toContain('All day')
    })

    it('includes location and attendees', () => {
      const evt = createCalendarEvent({
        id: 'e3',
        title: 'Review',
        start: new Date('2025-01-13T10:00:00Z'),
        end: new Date('2025-01-13T11:00:00Z'),
        location: 'Board Room',
        attendees: ['alice@example.com'],
        description: 'Year-end review.',
      })
      const text = code._formatEventEntryGAS_(evt, 'UTC')
      expect(text).toContain('Board Room')
      expect(text).toContain('alice@example.com')
      expect(text).toContain('Year-end review.')
    })

    it('includes calendar name when provided', () => {
      const evt = createCalendarEvent({
        id: 'e4',
        title: 'Work Event',
        start: new Date('2025-01-13T10:00:00Z'),
        end: new Date('2025-01-13T11:00:00Z'),
      })
      const text = code._formatEventEntryGAS_(evt, 'UTC', 'Work')
      expect(text).toContain('\uD83D\uDCC5 Work')
    })

    it('omits calendar name when not provided', () => {
      const evt = createCalendarEvent({
        id: 'e5',
        title: 'Primary Event',
        start: new Date('2025-01-13T10:00:00Z'),
        end: new Date('2025-01-13T11:00:00Z'),
      })
      const text = code._formatEventEntryGAS_(evt, 'UTC')
      expect(text).not.toContain('\uD83D\uDCC5')
    })
  })

  describe('_detectConflictsGAS_', () => {
    it('detects overlapping events', () => {
      const tuples = [
        {
          event: createCalendarEvent({
            id: 'e1',
            title: 'A',
            start: new Date('2025-01-13T09:00:00Z'),
            end: new Date('2025-01-13T10:00:00Z'),
          }),
          calendarName: null,
        },
        {
          event: createCalendarEvent({
            id: 'e2',
            title: 'B',
            start: new Date('2025-01-13T09:30:00Z'),
            end: new Date('2025-01-13T10:30:00Z'),
          }),
          calendarName: 'Work',
        },
      ]
      const conflicts = code._detectConflictsGAS_(tuples, 'UTC')
      expect(conflicts).toHaveLength(1)
    })

    it('returns empty for non-overlapping events', () => {
      const tuples = [
        {
          event: createCalendarEvent({
            id: 'e1',
            title: 'A',
            start: new Date('2025-01-13T09:00:00Z'),
            end: new Date('2025-01-13T10:00:00Z'),
          }),
          calendarName: null,
        },
        {
          event: createCalendarEvent({
            id: 'e2',
            title: 'B',
            start: new Date('2025-01-13T10:00:00Z'),
            end: new Date('2025-01-13T11:00:00Z'),
          }),
          calendarName: null,
        },
      ]
      expect(code._detectConflictsGAS_(tuples, 'UTC')).toHaveLength(0)
    })
  })

  describe('_formatConflictWarningGAS_', () => {
    it('formats conflict warning text', () => {
      const conflicts = [
        {
          a: {
            event: createCalendarEvent({
              id: 'e1',
              title: 'A',
              start: new Date('2025-01-13T09:00:00Z'),
              end: new Date('2025-01-13T10:00:00Z'),
            }),
            calendarName: null,
          },
          b: {
            event: createCalendarEvent({
              id: 'e2',
              title: 'B',
              start: new Date('2025-01-13T09:30:00Z'),
              end: new Date('2025-01-13T10:30:00Z'),
            }),
            calendarName: 'Work',
          },
        },
      ]
      const warning = code._formatConflictWarningGAS_(conflicts, 'UTC')
      expect(warning).toContain('\u26A0\uFE0F')
      expect(warning).toContain('overlaps with')
      expect(warning).toContain('B (Work)')
    })

    it('returns empty for no conflicts', () => {
      expect(code._formatConflictWarningGAS_([], 'UTC')).toBe('')
    })
  })

  describe('_formatBriefingGAS_', () => {
    it('returns title only for empty groupedEvents', () => {
      const text = code._formatBriefingGAS_('Empty Briefing', new Map(), 'UTC')
      expect(text).toBe('Empty Briefing')
    })

    it('formats a single day with events', () => {
      const e1 = createCalendarEvent({
        id: 'e1',
        title: 'Sprint',
        start: new Date('2025-01-13T10:00:00Z'),
        end: new Date('2025-01-13T11:00:00Z'),
      })
      const grouped = new Map([['2025-01-13', [e1]]])
      const text = code._formatBriefingGAS_('Weekly Briefing', grouped, 'UTC')
      expect(text).toContain('Weekly Briefing')
      expect(text).toContain('Monday, January 13')
      expect(text).toContain('Sprint')
    })

    it('includes conflict warnings for overlapping events', () => {
      const tuples = [
        {
          event: createCalendarEvent({
            id: 'e1',
            title: 'Meeting A',
            start: new Date('2025-01-13T09:00:00Z'),
            end: new Date('2025-01-13T10:00:00Z'),
          }),
          calendarName: null,
        },
        {
          event: createCalendarEvent({
            id: 'e2',
            title: 'Meeting B',
            start: new Date('2025-01-13T09:30:00Z'),
            end: new Date('2025-01-13T10:30:00Z'),
          }),
          calendarName: 'Work',
        },
      ]
      const grouped = new Map([['2025-01-13', tuples]])
      const text = code._formatBriefingGAS_('Briefing', grouped, 'UTC')
      expect(text).toContain('\u26A0\uFE0F')
      expect(text).toContain('overlaps with')
    })
  })

  describe('_shouldRunNowGAS_', () => {
    it('returns true on matching weekly day and hour', () => {
      const cfg = {
        scheduleFrequency: 'weekly',
        scheduleDay: 'MONDAY',
        scheduleHour: 7,
      }
      const now = new Date('2025-01-13T07:00:00')
      expect(code._shouldRunNowGAS_(cfg, now, null)).toBe(true)
    })

    it('returns false on wrong hour', () => {
      const cfg = {
        scheduleFrequency: 'weekly',
        scheduleDay: 'MONDAY',
        scheduleHour: 7,
      }
      const now = new Date('2025-01-13T08:00:00')
      expect(code._shouldRunNowGAS_(cfg, now, null)).toBe(false)
    })

    it('returns true for every-N-days when interval elapsed', () => {
      const cfg = {
        scheduleFrequency: 'days',
        scheduleIntervalDays: 2,
        scheduleHour: 6,
      }
      const now = new Date('2025-01-15T06:00:00')
      const lastRun = new Date('2025-01-13T06:00:00').getTime()
      expect(code._shouldRunNowGAS_(cfg, now, lastRun)).toBe(true)
    })
  })

  describe('generateWeeklyBriefing', () => {
    // Helper: get schedule fields that match the current hour/day so tests pass
    function scheduleNow() {
      const now = new Date()
      const days = [
        'SUNDAY',
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
        'SATURDAY',
      ]
      return {
        scheduleFrequency: 'weekly',
        scheduleDay: days[now.getDay()],
        scheduleHour: now.getHours(),
      }
    }

    it('skips configs missing emailRecipients', () => {
      global.BRIEFING_CONFIGS = [
        { calendarId: 'primary', lookaheadDays: 7, ...scheduleNow() },
      ]
      delete require.cache[require.resolve('../code.gs')]
      const freshCode = require('../code.gs')
      expect(() => freshCode.generateWeeklyBriefing()).not.toThrow()
      expect(GmailApp.__sentEmails).toHaveLength(0)
      delete global.BRIEFING_CONFIGS
    })

    it('skips configs missing calendarId when useAllCalendars is off', () => {
      global.BRIEFING_CONFIGS = [
        { emailRecipients: ['a@b.com'], lookaheadDays: 7, ...scheduleNow() },
      ]
      delete require.cache[require.resolve('../code.gs')]
      const freshCode = require('../code.gs')
      expect(() => freshCode.generateWeeklyBriefing()).not.toThrow()
      expect(GmailApp.__sentEmails).toHaveLength(0)
      delete global.BRIEFING_CONFIGS
    })

    it('emails briefing for a valid legacy config', () => {
      const futureStart = new Date(Date.now() + 60 * 60 * 1000)
      const futureEnd = new Date(Date.now() + 2 * 60 * 60 * 1000)
      CalendarApp.getDefaultCalendar().__addEvent(
        createCalendarEvent({
          id: 'e1',
          title: 'Sprint Planning',
          start: futureStart,
          end: futureEnd,
        })
      )
      global.BRIEFING_CONFIGS = [
        {
          calendarId: 'primary',
          lookaheadDays: 7,
          emailRecipients: ['user@example.com'],
          ...scheduleNow(),
        },
      ]
      delete require.cache[require.resolve('../code.gs')]
      const freshCode = require('../code.gs')
      freshCode.generateWeeklyBriefing()
      expect(GmailApp.__sentEmails).toHaveLength(1)
      expect(GmailApp.__sentEmails[0].to).toBe('user@example.com')
      expect(GmailApp.__sentEmails[0].body).toContain('Weekly Briefing')
      expect(GmailApp.__sentEmails[0].body).toContain('Sprint Planning')
      delete global.BRIEFING_CONFIGS
    })

    it('emails briefing with useAllCalendars and labels non-primary events', () => {
      const futureStart = new Date(Date.now() + 60 * 60 * 1000)
      const futureEnd = new Date(Date.now() + 2 * 60 * 60 * 1000)
      const work = createCalendar('work@group.calendar', 'Work')
      work.__addEvent(
        createCalendarEvent({
          id: 'e1',
          title: 'Work Standup',
          start: futureStart,
          end: futureEnd,
        })
      )
      CalendarApp.__addCalendar(work)
      global.BRIEFING_CONFIGS = [
        {
          useAllCalendars: true,
          lookaheadDays: 7,
          emailRecipients: ['user@example.com'],
          ...scheduleNow(),
        },
      ]
      delete require.cache[require.resolve('../code.gs')]
      const freshCode = require('../code.gs')
      freshCode.generateWeeklyBriefing()
      expect(GmailApp.__sentEmails).toHaveLength(1)
      const body = GmailApp.__sentEmails[0].body
      expect(body).toContain('Weekly Briefing')
      expect(body).toContain('\uD83D\uDCC5 Work')
      delete global.BRIEFING_CONFIGS
    })

    it('sends email with custom subject', () => {
      const futureStart = new Date(Date.now() + 60 * 60 * 1000)
      const futureEnd = new Date(Date.now() + 2 * 60 * 60 * 1000)
      CalendarApp.getDefaultCalendar().__addEvent(
        createCalendarEvent({
          id: 'e2',
          title: 'All Hands',
          start: futureStart,
          end: futureEnd,
        })
      )
      global.BRIEFING_CONFIGS = [
        {
          calendarId: 'primary',
          lookaheadDays: 7,
          emailRecipients: ['boss@example.com'],
          emailSubject: 'Your Weekly Briefing',
          ...scheduleNow(),
        },
      ]
      delete require.cache[require.resolve('../code.gs')]
      const freshCode = require('../code.gs')
      freshCode.generateWeeklyBriefing()
      expect(GmailApp.__sentEmails).toHaveLength(1)
      expect(GmailApp.__sentEmails[0].to).toBe('boss@example.com')
      expect(GmailApp.__sentEmails[0].subject).toBe('Your Weekly Briefing')
      delete global.BRIEFING_CONFIGS
    })

    it('skips config when schedule does not match', () => {
      global.BRIEFING_CONFIGS = [
        {
          calendarId: 'primary',
          emailRecipients: ['user@example.com'],
          lookaheadDays: 7,
          scheduleFrequency: 'weekly',
          scheduleDay: 'MONDAY',
          scheduleHour: 99,
        },
      ]
      delete require.cache[require.resolve('../code.gs')]
      const freshCode = require('../code.gs')
      freshCode.generateWeeklyBriefing()
      expect(GmailApp.__sentEmails).toHaveLength(0)
      delete global.BRIEFING_CONFIGS
    })

    it('logs and continues on error (does not throw)', () => {
      global.BRIEFING_CONFIGS = [
        {
          calendarId: 'nonexistent',
          emailRecipients: ['a@b.com'],
          lookaheadDays: 7,
          ...scheduleNow(),
        },
      ]
      const origGetById = CalendarApp.getCalendarById
      CalendarApp.getCalendarById = (id) => {
        if (id === 'nonexistent') throw new Error('Calendar not found')
        return origGetById(id)
      }
      delete require.cache[require.resolve('../code.gs')]
      const freshCode = require('../code.gs')
      expect(() => freshCode.generateWeeklyBriefing()).not.toThrow()
      CalendarApp.getCalendarById = origGetById
      delete global.BRIEFING_CONFIGS
    })

    it('handles empty BRIEFING_CONFIGS gracefully', () => {
      global.BRIEFING_CONFIGS = []
      delete require.cache[require.resolve('../code.gs')]
      const freshCode = require('../code.gs')
      expect(() => freshCode.generateWeeklyBriefing()).not.toThrow()
      delete global.BRIEFING_CONFIGS
    })
  })
})
