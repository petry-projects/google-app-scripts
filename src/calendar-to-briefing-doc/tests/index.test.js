const {
  installGlobals,
  resetAll,
  createCalendarEvent,
} = require('../../../test-utils/mocks')
const {
  fetchEvents,
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
      calendar,
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
      calendar,
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
    const calendar = CalendarApp.getCalendarById('primary')
    const doc = DocumentApp.openById('docC')
    const config = { calendarId: 'primary', docId: 'docC' }

    generateBriefingForConfig(
      calendar,
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
    const calendar = CalendarApp.getCalendarById('primary')
    const doc = DocumentApp.openById('docD')
    doc.id = 'myDocId'
    const config = {
      calendarId: 'primary',
      docId: 'docD',
      emailRecipients: ['x@example.com'],
    }

    generateBriefingForConfig(
      calendar,
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
    it('skips configs missing calendarId', () => {
      global.BRIEFING_CONFIGS = [{ docId: 'doc1', lookaheadDays: 7 }]
      delete require.cache[require.resolve('../code.gs')]
      const freshCode = require('../code.gs')

      expect(() => freshCode.generateWeeklyBriefing()).not.toThrow()
      delete global.BRIEFING_CONFIGS
    })

    it('skips configs missing docId', () => {
      global.BRIEFING_CONFIGS = [{ calendarId: 'primary', lookaheadDays: 7 }]
      delete require.cache[require.resolve('../code.gs')]
      const freshCode = require('../code.gs')

      expect(() => freshCode.generateWeeklyBriefing()).not.toThrow()
      delete global.BRIEFING_CONFIGS
    })

    it('writes briefing doc for a valid config', () => {
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
      // CalendarApp.getCalendarById will return the mock which works fine;
      // force an error by making DocumentApp throw on open
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
