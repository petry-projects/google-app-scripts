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
 * Groups events by day using a caller-supplied date-key function.
 * Returns a Map<dateKey, events[]> sorted by date key ascending (oldest first).
 * Days with no events are omitted.
 * @param {Array} events
 * @param {function(Date): string} getDateKey - returns a 'YYYY-MM-DD' string
 * @returns {Map<string, Array>}
 */
function groupEventsByDay(events, getDateKey) {
  const map = new Map()
  for (const event of events) {
    const key = getDateKey(event.getStartTime())
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(event)
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
function formatEventEntry(event, formatTime) {
  const title = event.getTitle() || '(No Title)'
  const location = event.getLocation() || ''
  const description = event.getDescription() || ''
  const attendees = (event.getGuestList() || [])
    .map((g) => g.getEmail())
    .filter(Boolean)
  const isAllDay =
    typeof event.isAllDayEvent === 'function' && event.isAllDayEvent()

  const lines = [title]
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
 * Writes the weekly briefing to a Google Doc.
 * Clears the doc body first (idempotent), then writes the title followed by
 * day sections. Days with no events are skipped. Events within each day are
 * sorted by start time ascending.
 *
 * @param {Object} doc - GAS Document
 * @param {string} title - Briefing title line
 * @param {Map<string, Array>} groupedEvents - from groupEventsByDay
 * @param {function(Date): string} formatTime
 * @param {Object} DocumentApp - GAS DocumentApp global (for enum access)
 */
function writeBriefingDoc(doc, title, groupedEvents, formatTime, DocumentApp) {
  const body = doc.getBody()
  body.clear()

  const titlePara = body.appendParagraph(title)
  titlePara.setAttributes({ [DocumentApp.Attribute.BOLD]: true })

  for (const [dateKey, events] of groupedEvents.entries()) {
    const dayLabel = formatDayLabel(dateKey)
    const heading = body.appendParagraph(dayLabel)
    heading.setHeading(DocumentApp.ParagraphHeading.HEADING_3)

    const sorted = [...events].sort(
      (a, b) => a.getStartTime().getTime() - b.getStartTime().getTime()
    )
    for (const event of sorted) {
      body.appendParagraph(formatEventEntry(event, formatTime))
    }
  }
}

/**
 * Sends an email with a link to the briefing doc.
 * No-op if recipients is empty or falsy.
 * @param {Object} gmailApp - GAS GmailApp global
 * @param {string[]} recipients
 * @param {string} subject
 * @param {string} docUrl
 */
function emailBriefing(gmailApp, recipients, subject, docUrl) {
  if (!recipients || !recipients.length) return
  const body = `Your weekly briefing is ready:\n\n${docUrl}`
  for (const recipient of recipients) {
    gmailApp.sendEmail(recipient, subject, body)
  }
}

/**
 * Generates a briefing for a single config entry.
 * @param {Object} calendar - GAS Calendar
 * @param {Object} doc - GAS Document
 * @param {Object} gmailApp - GAS GmailApp global
 * @param {Object} config - single BRIEFING_CONFIGS entry
 * @param {function(Date): string} getDateKey - maps Date to 'YYYY-MM-DD'
 * @param {function(Date): string} formatTime - maps Date to time string
 * @param {Object} DocumentApp - GAS DocumentApp global (for enum access)
 */
function generateBriefingForConfig(
  calendar,
  doc,
  gmailApp,
  config,
  getDateKey,
  formatTime,
  DocumentApp
) {
  const now = new Date()
  // Round start down to the beginning of today so events before the trigger
  // time are not silently excluded from Day 1 of the briefing.
  now.setHours(0, 0, 0, 0)
  // Advance by calendar days (not raw ms) to handle DST transitions correctly.
  const end = new Date(now)
  end.setDate(end.getDate() + (config.lookaheadDays || 7))

  const events = fetchEvents(calendar, now, end)
  const grouped = groupEventsByDay(events, getDateKey)

  // end is exclusive (start of the day after the last included day), so
  // subtract 1ms to get a timestamp within the last included day for labeling.
  const lastIncludedDay = new Date(end.getTime() - 1)
  const briefingTitle = `Weekly Briefing: ${formatDayLabel(getDateKey(now))} \u2013 ${formatDayLabel(getDateKey(lastIncludedDay))}`
  writeBriefingDoc(doc, briefingTitle, grouped, formatTime, DocumentApp)

  if (config.emailRecipients && config.emailRecipients.length) {
    const docId = typeof doc.getId === 'function' ? doc.getId() : doc.id || ''
    const docUrl = `https://docs.google.com/document/d/${docId}/edit`
    emailBriefing(
      gmailApp,
      config.emailRecipients,
      config.emailSubject || 'Weekly Briefing',
      docUrl
    )
  }
}

module.exports = {
  fetchEvents,
  groupEventsByDay,
  formatDayLabel,
  formatEventEntry,
  writeBriefingDoc,
  emailBriefing,
  generateBriefingForConfig,
}
