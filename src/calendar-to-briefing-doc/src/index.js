/**
 * Pure, testable core logic for calendar-to-briefing-doc.
 * No GAS globals are used here — all dependencies are injected.
 */

/**
 * Fetches events from a calendar between start and end dates.
 * @param {Object} calendar - GAS Calendar object
 * @param {Date} start
 * @param {Date} end
 * @returns {Array}
 */
function fetchEvents(calendar, start, end) {
  return calendar.getEvents(start, end)
}

/**
 * Fetches events from multiple calendars, tagging each with its source calendar name.
 * Events from the default calendar get calendarName = null.
 * @param {Array} calendars - Array of GAS Calendar objects
 * @param {string} defaultCalendarId - ID of the user's primary calendar
 * @param {Date} start
 * @param {Date} end
 * @param {string[]} [excludeCalendars] - Calendar IDs to skip
 * @returns {Array<{event: Object, calendarName: string|null}>}
 */
function fetchAllCalendarEvents(
  calendars,
  defaultCalendarId,
  start,
  end,
  excludeCalendars
) {
  const excluded = new Set(excludeCalendars || [])
  const tuples = []
  for (const cal of calendars) {
    const calId = typeof cal.getId === 'function' ? cal.getId() : cal.id || ''
    if (excluded.has(calId)) continue
    const events = fetchEvents(cal, start, end)
    const calName = calId === defaultCalendarId ? null : cal.getName()
    for (const event of events) {
      tuples.push({ event, calendarName: calName })
    }
  }
  return tuples
}

/**
 * Detects time conflicts among events for a single day.
 * All-day events are excluded from conflict detection.
 * @param {Array<{event: Object, calendarName: string|null}>} eventTuples
 * @returns {Array<{a: Object, b: Object}>} conflict pairs with title, calendarName, start, end
 */
function detectConflicts(eventTuples) {
  const timed = eventTuples.filter(
    (t) =>
      !(typeof t.event.isAllDayEvent === 'function' && t.event.isAllDayEvent())
  )
  timed.sort(
    (a, b) =>
      a.event.getStartTime().getTime() - b.event.getStartTime().getTime()
  )
  const conflicts = []
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const aStart = timed[i].event.getStartTime().getTime()
      const aEnd = timed[i].event.getEndTime().getTime()
      const bStart = timed[j].event.getStartTime().getTime()
      const bEnd = timed[j].event.getEndTime().getTime()
      if (aStart < bEnd && bStart < aEnd) {
        conflicts.push({
          a: {
            title: timed[i].event.getTitle() || '(No Title)',
            calendarName: timed[i].calendarName,
            start: timed[i].event.getStartTime(),
            end: timed[i].event.getEndTime(),
          },
          b: {
            title: timed[j].event.getTitle() || '(No Title)',
            calendarName: timed[j].calendarName,
            start: timed[j].event.getStartTime(),
            end: timed[j].event.getEndTime(),
          },
        })
      }
    }
  }
  return conflicts
}

/**
 * Formats conflict warnings as a human-readable string.
 * @param {Array<{a: Object, b: Object}>} conflicts
 * @param {function(Date): string} formatTime
 * @returns {string}
 */
function formatConflictWarning(conflicts, formatTime) {
  if (!conflicts || !conflicts.length) return ''
  return conflicts
    .map((c) => {
      const aLabel = c.a.calendarName
        ? `${c.a.title} (${c.a.calendarName})`
        : c.a.title
      const bLabel = c.b.calendarName
        ? `${c.b.title} (${c.b.calendarName})`
        : c.b.title
      const aTime = `${formatTime(c.a.start)}\u2013${formatTime(c.a.end)}`
      const bTime = `${formatTime(c.b.start)}\u2013${formatTime(c.b.end)}`
      return `\u26A0\uFE0F "${aLabel}" (${aTime}) overlaps with "${bLabel}" (${bTime})`
    })
    .join('\n')
}

/**
 * Groups events by day using a caller-supplied date-key function.
 * Returns a Map<dateKey, events[]> sorted by date key ascending (oldest first).
 * Days with no events are omitted.
 * @param {Array} events
 * @param {function(Date): string} getDateKey - returns a 'YYYY-MM-DD' string
 * @returns {Map<string, Array>}
 */
function groupEventsByDay(events, getDateKey) {
  const map = new Map()
  for (const item of events) {
    const evt = item && item.event ? item.event : item
    const key = getDateKey(evt.getStartTime())
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(item)
  }
  return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])))
}

/**
 * Formats a 'YYYY-MM-DD' string as a human-readable day label.
 * e.g. '2025-01-13' -> 'Monday, January 13'
 * @param {string} dateKey
 * @returns {string}
 */
function formatDayLabel(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  const DAYS = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ]
  const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]
  return `${DAYS[date.getUTCDay()]}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`
}

/**
 * Formats a single calendar event as a text block.
 * @param {Object} event - GAS CalendarEvent
 * @param {function(Date): string} formatTime - formats a Date to a time string
 * @returns {string}
 */
function formatEventEntry(event, formatTime, calendarName) {
  const title = event.getTitle() || '(No Title)'
  const location = event.getLocation() || ''
  const description = event.getDescription() || ''
  const attendees = (event.getGuestList() || [])
    .map((g) => g.getEmail())
    .filter(Boolean)
  const isAllDay =
    typeof event.isAllDayEvent === 'function' && event.isAllDayEvent()

  const lines = [title]
  if (calendarName) lines.push(`\uD83D\uDCC5 ${calendarName}`)
  if (isAllDay) {
    lines.push('All day')
  } else {
    lines.push(
      `${formatTime(event.getStartTime())} \u2013 ${formatTime(event.getEndTime())}`
    )
  }

  if (location) lines.push(`\uD83D\uDCCD ${location}`)
  if (attendees.length) lines.push(`\uD83D\uDC65 ${attendees.join(', ')}`)
  if (description) lines.push(description.trim())

  return lines.join('\n')
}

/**
 * Formats the full briefing as a plain text string.
 * @param {string} title - Briefing title line
 * @param {Map<string, Array>} groupedEvents - from groupEventsByDay
 * @param {function(Date): string} formatTime
 * @returns {string}
 */
function formatBriefing(title, groupedEvents, formatTime) {
  const sections = [title, '']

  for (const [dateKey, items] of groupedEvents.entries()) {
    const dayLabel = formatDayLabel(dateKey)
    sections.push(dayLabel)

    // Detect if items are tuples or plain events
    const isTuple = items.length > 0 && items[0] && items[0].event
    const tuples = isTuple
      ? items
      : items.map((e) => ({ event: e, calendarName: null }))

    const conflicts = detectConflicts(tuples)
    const warning = formatConflictWarning(conflicts, formatTime)
    if (warning) {
      sections.push(warning)
    }

    const sorted = [...tuples].sort(
      (a, b) =>
        a.event.getStartTime().getTime() - b.event.getStartTime().getTime()
    )
    for (const tuple of sorted) {
      sections.push(
        formatEventEntry(tuple.event, formatTime, tuple.calendarName)
      )
    }

    sections.push('')
  }

  return sections.join('\n').trimEnd()
}

/**
 * Sends an email with the briefing content.
 * No-op if recipients is empty or falsy.
 * @param {Object} gmailApp - GAS GmailApp global
 * @param {string[]} recipients
 * @param {string} subject
 * @param {string} body - The full briefing text
 */
function emailBriefing(gmailApp, recipients, subject, body) {
  if (!recipients || !recipients.length) return
  for (const recipient of recipients) {
    gmailApp.sendEmail(recipient, subject, body)
  }
}

/**
 * Determines whether the briefing should run now based on schedule config.
 * Called every hour by the trigger; returns true only at the scheduled time.
 *
 * @param {Object} config - BRIEFING_CONFIGS entry with schedule fields
 * @param {Date} now - current date/time
 * @param {number|null} lastRunMs - timestamp (ms) of the last successful run, or null
 * @returns {boolean}
 */
function shouldRunNow(config, now, lastRunMs) {
  const hour = now.getHours()
  const scheduleHour = config.scheduleHour != null ? config.scheduleHour : 7

  if (hour !== scheduleHour) return false

  const frequency = config.scheduleFrequency || 'weekly'

  if (frequency === 'weekly') {
    const DAY_MAP = {
      SUNDAY: 0,
      MONDAY: 1,
      TUESDAY: 2,
      WEDNESDAY: 3,
      THURSDAY: 4,
      FRIDAY: 5,
      SATURDAY: 6,
    }
    const targetDay = DAY_MAP[config.scheduleDay || 'MONDAY']
    return now.getDay() === targetDay
  }

  if (frequency === 'days') {
    const intervalDays = config.scheduleIntervalDays || 1
    if (lastRunMs == null) return true
    const elapsed = now.getTime() - lastRunMs
    const daysSinceLastRun = elapsed / (24 * 60 * 60 * 1000)
    return daysSinceLastRun >= intervalDays
  }

  return true
}

/**
 * Generates a briefing for a single config entry.
 * @param {Object} calendarApp - GAS CalendarApp global (or single calendar for legacy mode)
 * @param {Object} gmailApp - GAS GmailApp global
 * @param {Object} config - single BRIEFING_CONFIGS entry
 * @param {function(Date): string} getDateKey - maps Date to 'YYYY-MM-DD'
 * @param {function(Date): string} formatTime - maps Date to time string
 */
function generateBriefingForConfig(
  calendarApp,
  gmailApp,
  config,
  getDateKey,
  formatTime
) {
  if (!config.emailRecipients || !config.emailRecipients.length) {
    throw new Error('emailRecipients is required')
  }

  const now = new Date()
  // Round start down to the beginning of today so events before the trigger
  // time are not silently excluded from Day 1 of the briefing.
  now.setHours(0, 0, 0, 0)
  // Advance by calendar days (not raw ms) to handle DST transitions correctly.
  const end = new Date(now)
  end.setDate(end.getDate() + (config.lookaheadDays || 7))

  let eventTuples
  if (config.useAllCalendars) {
    const calendars = calendarApp.getAllCalendars()
    const defaultId = calendarApp.getDefaultCalendar().getId()
    eventTuples = fetchAllCalendarEvents(
      calendars,
      defaultId,
      now,
      end,
      config.excludeCalendars
    )
  } else {
    // Legacy single-calendar mode: calendarApp may be a CalendarApp or a
    // single calendar object. Support both for backward compatibility.
    const calendar =
      typeof calendarApp.getCalendarById === 'function'
        ? calendarApp.getCalendarById(config.calendarId)
        : calendarApp
    const events = fetchEvents(calendar, now, end)
    eventTuples = events.map((e) => ({ event: e, calendarName: null }))
  }

  const grouped = groupEventsByDay(eventTuples, getDateKey)

  // end is exclusive (start of the day after the last included day), so
  // subtract 1ms to get a timestamp within the last included day for labeling.
  const lastIncludedDay = new Date(end.getTime() - 1)
  const briefingTitle = `Weekly Briefing: ${formatDayLabel(getDateKey(now))} \u2013 ${formatDayLabel(getDateKey(lastIncludedDay))}`
  const briefingText = formatBriefing(briefingTitle, grouped, formatTime)

  emailBriefing(
    gmailApp,
    config.emailRecipients,
    config.emailSubject || 'Weekly Briefing',
    briefingText
  )
}

module.exports = {
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
}
