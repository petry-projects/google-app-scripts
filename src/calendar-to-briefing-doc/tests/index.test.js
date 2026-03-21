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
  writeBriefingDoc,
  emailBriefing,
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

// ── writeBriefingDoc ──────────────────────────────────────────────────────────

describe('writeBriefingDoc', () => {
  it('clears the doc and writes title + day sections', () => {
    const doc = DocumentApp.openById('doc1')
    // Pre-populate to verify clear works
    doc.getBody().appendParagraph('Old content')

    const e1 = createCalendarEvent({
      id: 'e1',
      title: 'Standup',
      start: new Date('2025-01-13T15:00:00Z'),
      end: new Date('2025-01-13T15:30:00Z'),
    })
    const grouped = new Map([['2025-01-13', [e1]]])

    writeBriefingDoc(
      doc,
      'Weekly Briefing',
      grouped,
      testFormatTime,
      DocumentApp
    )

    const paras = doc.getBody().getParagraphs()
    // Old content should be gone; should have: title, day heading, event
    expect(paras.length).toBe(3)
    expect(paras[0].getText()).toBe('Weekly Briefing')
    expect(paras[0].attrs).toEqual({ [DocumentApp.Attribute.BOLD]: true })
    expect(paras[1].getText()).toBe('Monday, January 13')
    expect(paras[1].heading).toBe(DocumentApp.ParagraphHeading.HEADING_3)
    expect(paras[2].getText()).toContain('Standup')
  })

  it('writes multiple days in ascending order', () => {
    const doc = DocumentApp.openById('doc2')
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

    writeBriefingDoc(doc, 'Briefing', grouped, testFormatTime, DocumentApp)
    const paras = doc.getBody().getParagraphs()
    const texts = paras.map((p) => p.getText())
    expect(texts.indexOf('Monday, January 13')).toBeLessThan(
      texts.indexOf('Tuesday, January 14')
    )
  })

  it('sorts events within a day by start time', () => {
    const doc = DocumentApp.openById('doc3')
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

    writeBriefingDoc(doc, 'Briefing', grouped, testFormatTime, DocumentApp)
    const paras = doc
      .getBody()
      .getParagraphs()
      .map((p) => p.getText())
    const morningIdx = paras.findIndex((t) => t.includes('Morning'))
    const afternoonIdx = paras.findIndex((t) => t.includes('Afternoon'))
    expect(morningIdx).toBeLessThan(afternoonIdx)
  })

  it('writes no day sections for empty groupedEvents', () => {
    const doc = DocumentApp.openById('doc4')
    writeBriefingDoc(
      doc,
      'Empty Briefing',
      new Map(),
      testFormatTime,
      DocumentApp
    )
    const paras = doc.getBody().getParagraphs()
    expect(paras.length).toBe(1) // only title
    expect(paras[0].getText()).toBe('Empty Briefing')
  })
})

// ── emailBriefing ─────────────────────────────────────────────────────────────

describe('emailBriefing', () => {
  it('sends an email to each recipient', () => {
    emailBriefing(
      GmailApp,
      ['alice@example.com', 'bob@example.com'],
      'Weekly Briefing',
      'https://docs.google.com/document/d/abc/edit'
    )
    const sent = GmailApp.__sentEmails
    expect(sent).toHaveLength(2)
    expect(sent[0].to).toBe('alice@example.com')
    expect(sent[0].subject).toBe('Weekly Briefing')
    expect(sent[0].body).toContain(
      'https://docs.google.com/document/d/abc/edit'
    )
    expect(sent[1].to).toBe('bob@example.com')
  })

  it('is a no-op for empty recipients array', () => {
    emailBriefing(GmailApp, [], 'Subject', 'http://example.com')
    expect(GmailApp.__sentEmails).toHaveLength(0)
  })

  it('is a no-op for null recipients', () => {
    emailBriefing(GmailApp, null, 'Subject', 'http://example.com')
    expect(GmailApp.__sentEmails).toHaveLength(0)
  })
})

// ── generateBriefingForConfig ─────────────────────────────────────────────────

describe('generateBriefingForConfig', () => {
  it('writes briefing doc and skips email when no recipients', () => {
    const calendar = CalendarApp.getCalendarById('primary')
    const futureStart = new Date(Date.now() + 60 * 60 * 1000) // 1h from now
    const futureEnd = new Date(Date.now() + 2 * 60 * 60 * 1000)
    const evt = createCalendarEvent({
      id: 'e1',
      title: 'Sprint Review',
      start: futureStart,
      end: futureEnd,
    })
    calendar.__addEvent(evt)

    const doc = DocumentApp.openById('docA')
    const config = {
      calendarId: 'primary',
      docId: 'docA',
      lookaheadDays: 7,
      emailRecipients: [],
    }

    generateBriefingForConfig(
      CalendarApp,
      doc,
      GmailApp,
      config,
      testDateKey,
      testFormatTime,
      DocumentApp
    )

    const paras = doc.getBody().getParagraphs()
    expect(paras.length).toBeGreaterThan(0)
    expect(paras[0].getText()).toContain('Weekly Briefing')
    expect(GmailApp.__sentEmails).toHaveLength(0)
  })

  it('sends email when recipients are configured', () => {
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

    const doc = DocumentApp.openById('docB')
    const config = {
      calendarId: 'primary',
      docId: 'docB',
      lookaheadDays: 7,
      emailRecipients: ['manager@example.com'],
      emailSubject: 'My Weekly Briefing',
    }

    generateBriefingForConfig(
      CalendarApp,
      doc,
      GmailApp,
      config,
      testDateKey,
      testFormatTime,
      DocumentApp
    )

    expect(GmailApp.__sentEmails).toHaveLength(1)
    expect(GmailApp.__sentEmails[0].subject).toBe('My Weekly Briefing')
    expect(GmailApp.__sentEmails[0].to).toBe('manager@example.com')
  })

  it('uses default lookaheadDays of 7 when not specified', () => {
    const doc = DocumentApp.openById('docC')
    const config = { calendarId: 'primary', docId: 'docC' }

    generateBriefingForConfig(
      CalendarApp,
      doc,
      GmailApp,
      config,
      testDateKey,
      testFormatTime,
      DocumentApp
    )
    // Just verifies no error is thrown and doc title is written
    expect(doc.getBody().getParagraphs()[0].getText()).toContain(
      'Weekly Briefing'
    )
  })

  it('uses default email subject when emailSubject is not set', () => {
    const doc = DocumentApp.openById('docD')
    doc.id = 'myDocId'
    const config = {
      calendarId: 'primary',
      docId: 'docD',
      emailRecipients: ['x@example.com'],
    }

    generateBriefingForConfig(
      CalendarApp,
      doc,
      GmailApp,
      config,
      testDateKey,
      testFormatTime,
      DocumentApp
    )
    expect(GmailApp.__sentEmails[0].subject).toBe('Weekly Briefing')
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
    // A-B, A-C, B-C
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

// ── writeBriefingDoc with conflicts ─────────────────────────────────────────

describe('writeBriefingDoc with conflicts and calendar names', () => {
  it('writes conflict warning when events overlap', () => {
    const doc = DocumentApp.openById('conflictDoc')
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

    writeBriefingDoc(doc, 'Briefing', grouped, testFormatTime, DocumentApp)

    const paras = doc.getBody().getParagraphs()
    const texts = paras.map((p) => p.getText())
    // title, day heading, conflict warning, event A, event B
    expect(texts.some((t) => t.includes('\u26A0\uFE0F'))).toBe(true)
    expect(texts.some((t) => t.includes('\uD83D\uDCC5 Work'))).toBe(true)
  })

  it('writes no conflict warning when no overlaps', () => {
    const doc = DocumentApp.openById('noConflictDoc')
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

    writeBriefingDoc(doc, 'Briefing', grouped, testFormatTime, DocumentApp)

    const paras = doc.getBody().getParagraphs()
    const texts = paras.map((p) => p.getText())
    expect(texts.some((t) => t.includes('\u26A0\uFE0F'))).toBe(false)
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

    const doc = DocumentApp.openById('multiCalDoc')
    const config = {
      useAllCalendars: true,
      docId: 'multiCalDoc',
      lookaheadDays: 7,
    }

    generateBriefingForConfig(
      CalendarApp,
      doc,
      GmailApp,
      config,
      testDateKey,
      testFormatTime,
      DocumentApp
    )

    const paras = doc.getBody().getParagraphs()
    expect(paras.length).toBeGreaterThan(0)
    expect(paras[0].getText()).toContain('Weekly Briefing')
    // Work calendar events should have calendar name label
    const texts = paras.map((p) => p.getText())
    expect(texts.some((t) => t.includes('\uD83D\uDCC5 Work'))).toBe(true)
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

    const doc = DocumentApp.openById('excludeDoc')
    const config = {
      useAllCalendars: true,
      excludeCalendars: ['excluded@group.calendar'],
      docId: 'excludeDoc',
      lookaheadDays: 7,
    }

    generateBriefingForConfig(
      CalendarApp,
      doc,
      GmailApp,
      config,
      testDateKey,
      testFormatTime,
      DocumentApp
    )

    const texts = doc
      .getBody()
      .getParagraphs()
      .map((p) => p.getText())
    expect(texts.some((t) => t.includes('Should Not Appear'))).toBe(false)
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

    const doc = DocumentApp.openById('legacyDoc')
    const config = {
      calendarId: 'primary',
      docId: 'legacyDoc',
      lookaheadDays: 7,
    }

    generateBriefingForConfig(
      CalendarApp,
      doc,
      GmailApp,
      config,
      testDateKey,
      testFormatTime,
      DocumentApp
    )

    const texts = doc
      .getBody()
      .getParagraphs()
      .map((p) => p.getText())
    expect(texts.some((t) => t.includes('Legacy Event'))).toBe(true)
    // No calendar name labels in legacy mode
    expect(texts.some((t) => t.includes('\uD83D\uDCC5'))).toBe(false)
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
      global.BRIEFING_CONFIGS = [{ calendarId: 'cal1', docId: 'doc1' }]
      delete require.cache[require.resolve('../code.gs')]
      const freshCode = require('../code.gs')
      expect(freshCode.getBriefingConfigs_()).toEqual([
        { calendarId: 'cal1', docId: 'doc1' },
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

  describe('_writeBriefingDocGAS_', () => {
    it('clears the doc and writes sections', () => {
      const doc = DocumentApp.openById('gasDoc1')
      doc.getBody().appendParagraph('Stale content')

      const e1 = createCalendarEvent({
        id: 'e1',
        title: 'Sprint',
        start: new Date('2025-01-13T10:00:00Z'),
        end: new Date('2025-01-13T11:00:00Z'),
      })
      const grouped = new Map([['2025-01-13', [e1]]])

      code._writeBriefingDocGAS_(doc, 'Weekly Briefing', grouped, 'UTC')

      const paras = doc.getBody().getParagraphs()
      expect(paras.length).toBe(3)
      expect(paras[0].getText()).toBe('Weekly Briefing')
      expect(paras[1].heading).toBe(DocumentApp.ParagraphHeading.HEADING_3)
      expect(paras[2].getText()).toContain('Sprint')
    })
  })

  describe('generateWeeklyBriefing', () => {
    it('skips configs missing docId', () => {
      global.BRIEFING_CONFIGS = [{ calendarId: 'primary', lookaheadDays: 7 }]
      delete require.cache[require.resolve('../code.gs')]
      const freshCode = require('../code.gs')

      expect(() => freshCode.generateWeeklyBriefing()).not.toThrow()
      delete global.BRIEFING_CONFIGS
    })

    it('skips configs missing calendarId when useAllCalendars is off', () => {
      global.BRIEFING_CONFIGS = [{ docId: 'doc1', lookaheadDays: 7 }]
      delete require.cache[require.resolve('../code.gs')]
      const freshCode = require('../code.gs')

      expect(() => freshCode.generateWeeklyBriefing()).not.toThrow()
      delete global.BRIEFING_CONFIGS
    })

    it('writes briefing doc for a valid legacy config', () => {
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
        { calendarId: 'primary', docId: 'myDoc', lookaheadDays: 7 },
      ]
      delete require.cache[require.resolve('../code.gs')]
      const freshCode = require('../code.gs')

      freshCode.generateWeeklyBriefing()

      const doc = DocumentApp.openById('myDoc')
      const paras = doc.getBody().getParagraphs()
      expect(paras.length).toBeGreaterThan(0)
      expect(paras[0].getText()).toContain('Weekly Briefing')
      delete global.BRIEFING_CONFIGS
    })

    it('writes briefing with useAllCalendars and labels non-primary events', () => {
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
          docId: 'multiDoc',
          lookaheadDays: 7,
        },
      ]
      delete require.cache[require.resolve('../code.gs')]
      const freshCode = require('../code.gs')

      freshCode.generateWeeklyBriefing()

      const doc = DocumentApp.openById('multiDoc')
      const texts = doc
        .getBody()
        .getParagraphs()
        .map((p) => p.getText())
      expect(texts[0]).toContain('Weekly Briefing')
      expect(texts.some((t) => t.includes('\uD83D\uDCC5 Work'))).toBe(true)
      delete global.BRIEFING_CONFIGS
    })

    it('sends email when recipients are configured', () => {
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
          docId: 'emailDoc',
          lookaheadDays: 7,
          emailRecipients: ['boss@example.com'],
          emailSubject: 'Your Weekly Briefing',
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

    it('logs and continues on error (does not throw)', () => {
      const origOpen = DocumentApp.openById
      DocumentApp.openById = () => {
        throw new Error('Permission denied')
      }
      global.BRIEFING_CONFIGS = [
        { calendarId: 'primary', docId: 'badDoc', lookaheadDays: 7 },
      ]
      delete require.cache[require.resolve('../code.gs')]
      const freshCode = require('../code.gs')

      expect(() => freshCode.generateWeeklyBriefing()).not.toThrow()

      DocumentApp.openById = origOpen
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
