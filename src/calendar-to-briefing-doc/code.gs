/**
 * GAS entry point for Calendar to Briefing Doc.
 *
 * Place configuration in config.gs using BRIEFING_CONFIGS.
 * Core logic is duplicated inline here so this file can be deployed to
 * Google Apps Script as a standalone project (fetchScriptFiles only uploads
 * code.gs and config.gs). The companion src/index.js provides the same logic
 * in a testable, injectable form for Jest.
 */

function getBriefingConfigs_() {
  if (
    typeof BRIEFING_CONFIGS !== 'undefined' &&
    Array.isArray(BRIEFING_CONFIGS)
  ) {
    return BRIEFING_CONFIGS
  }
  return []
}

function _formatDayLabelGAS_(dateKey) {
  var parts = dateKey.split('-')
  var year = parseInt(parts[0], 10)
  var month = parseInt(parts[1], 10)
  var day = parseInt(parts[2], 10)
  var date = new Date(Date.UTC(year, month - 1, day))
  var DAYS = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ]
  var MONTHS = [
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
  return (
    DAYS[date.getUTCDay()] +
    ', ' +
    MONTHS[date.getUTCMonth()] +
    ' ' +
    date.getUTCDate()
  )
}

function _formatEventEntryGAS_(event, timezone, calendarName) {
  var title = event.getTitle() || '(No Title)'
  var location = event.getLocation() || ''
  var description = event.getDescription() || ''
  var guests = event.getGuestList() || []
  var attendees = guests
    .map(function (g) {
      return g.getEmail()
    })
    .filter(Boolean)
  var isAllDay =
    typeof event.isAllDayEvent === 'function' && event.isAllDayEvent()

  var lines = [title]
  if (calendarName) lines.push('\uD83D\uDCC5 ' + calendarName)
  if (isAllDay) {
    lines.push('All day')
  } else {
    var startStr = Utilities.formatDate(
      event.getStartTime(),
      timezone,
      'h:mm a'
    )
    var endStr = Utilities.formatDate(event.getEndTime(), timezone, 'h:mm a')
    lines.push(startStr + ' \u2013 ' + endStr)
  }
  if (location) lines.push('\uD83D\uDCCD ' + location)
  if (attendees.length) lines.push('\uD83D\uDC65 ' + attendees.join(', '))
  if (description) lines.push(description.trim())

  return lines.join('\n')
}

function _detectConflictsGAS_(eventTuples, timezone) {
  var timed = eventTuples.filter(function (t) {
    return !(
      typeof t.event.isAllDayEvent === 'function' && t.event.isAllDayEvent()
    )
  })
  timed.sort(function (a, b) {
    return a.event.getStartTime().getTime() - b.event.getStartTime().getTime()
  })
  var conflicts = []
  for (var i = 0; i < timed.length; i++) {
    for (var j = i + 1; j < timed.length; j++) {
      var aStart = timed[i].event.getStartTime().getTime()
      var aEnd = timed[i].event.getEndTime().getTime()
      var bStart = timed[j].event.getStartTime().getTime()
      var bEnd = timed[j].event.getEndTime().getTime()
      if (aStart < bEnd && bStart < aEnd) {
        conflicts.push({ a: timed[i], b: timed[j] })
      }
    }
  }
  return conflicts
}

function _formatConflictWarningGAS_(conflicts, timezone) {
  if (!conflicts || !conflicts.length) return ''
  return conflicts
    .map(function (c) {
      var aTitle = c.a.event.getTitle() || '(No Title)'
      var bTitle = c.b.event.getTitle() || '(No Title)'
      var aLabel = c.a.calendarName ? aTitle + ' (' + c.a.calendarName + ')' : aTitle
      var bLabel = c.b.calendarName ? bTitle + ' (' + c.b.calendarName + ')' : bTitle
      var aTime =
        Utilities.formatDate(c.a.event.getStartTime(), timezone, 'h:mm a') +
        '\u2013' +
        Utilities.formatDate(c.a.event.getEndTime(), timezone, 'h:mm a')
      var bTime =
        Utilities.formatDate(c.b.event.getStartTime(), timezone, 'h:mm a') +
        '\u2013' +
        Utilities.formatDate(c.b.event.getEndTime(), timezone, 'h:mm a')
      return (
        '\u26A0\uFE0F "' +
        aLabel +
        '" (' +
        aTime +
        ') overlaps with "' +
        bLabel +
        '" (' +
        bTime +
        ')'
      )
    })
    .join('\n')
}

function _writeBriefingDocGAS_(doc, title, groupedEvents, timezone) {
  var body = doc.getBody()
  body.clear()

  var titlePara = body.appendParagraph(title)
  var boldAttr = {}
  boldAttr[DocumentApp.Attribute.BOLD] = true
  titlePara.setAttributes(boldAttr)

  for (var entry of groupedEvents.entries()) {
    var dateKey = entry[0]
    var items = entry[1]
    var dayLabel = _formatDayLabelGAS_(dateKey)
    var heading = body.appendParagraph(dayLabel)
    heading.setHeading(DocumentApp.ParagraphHeading.HEADING_3)

    // Detect if items are tuples or plain events
    var isTuple = items.length > 0 && items[0] && items[0].event
    var tuples = isTuple
      ? items
      : items.map(function (e) {
          return { event: e, calendarName: null }
        })

    var conflicts = _detectConflictsGAS_(tuples, timezone)
    var warning = _formatConflictWarningGAS_(conflicts, timezone)
    if (warning) {
      body.appendParagraph(warning)
    }

    var sorted = tuples.slice().sort(function (a, b) {
      return (
        a.event.getStartTime().getTime() - b.event.getStartTime().getTime()
      )
    })
    for (var i = 0; i < sorted.length; i++) {
      body.appendParagraph(
        _formatEventEntryGAS_(sorted[i].event, timezone, sorted[i].calendarName)
      )
    }
  }
}

/**
 * Main trigger function. The deploy page installs an hourly trigger by default.
 * For a true weekly cadence, replace it with a weekly time-driven trigger
 * (e.g., every Monday at 7 AM) in the Apps Script editor.
 */
function generateWeeklyBriefing() {
  var configs = getBriefingConfigs_()
  var timezone = Session.getScriptTimeZone()

  for (var i = 0; i < configs.length; i++) {
    try {
      var cfg = configs[i]
      if (!cfg.docId) {
        Logger.log(
          '[generateWeeklyBriefing] Skipping config #' + i + ': missing docId'
        )
        continue
      }
      if (!cfg.useAllCalendars && !cfg.calendarId) {
        Logger.log(
          '[generateWeeklyBriefing] Skipping config #' +
            i +
            ': missing calendarId (useAllCalendars is off)'
        )
        continue
      }

      var doc = DocumentApp.openById(cfg.docId)
      var now = new Date()
      now.setHours(0, 0, 0, 0)
      var end = new Date(now)
      end.setDate(end.getDate() + (cfg.lookaheadDays || 7))

      var eventTuples = []
      if (cfg.useAllCalendars) {
        var allCalendars = CalendarApp.getAllCalendars()
        var defaultCalId = CalendarApp.getDefaultCalendar().getId()
        var excluded = new Set(cfg.excludeCalendars || [])
        for (var c = 0; c < allCalendars.length; c++) {
          var cal = allCalendars[c]
          var calId =
            typeof cal.getId === 'function' ? cal.getId() : cal.id || ''
          if (excluded.has(calId)) continue
          var calEvents = cal.getEvents(now, end)
          var calName = calId === defaultCalId ? null : cal.getName()
          for (var e = 0; e < calEvents.length; e++) {
            eventTuples.push({ event: calEvents[e], calendarName: calName })
          }
        }
      } else {
        var calendar = CalendarApp.getCalendarById(cfg.calendarId)
        var events = calendar.getEvents(now, end)
        for (var j = 0; j < events.length; j++) {
          eventTuples.push({ event: events[j], calendarName: null })
        }
      }

      // Group event tuples by day
      var map = new Map()
      for (var t = 0; t < eventTuples.length; t++) {
        var key = Utilities.formatDate(
          eventTuples[t].event.getStartTime(),
          timezone,
          'yyyy-MM-dd'
        )
        if (!map.has(key)) map.set(key, [])
        map.get(key).push(eventTuples[t])
      }
      var grouped = new Map(
        Array.from(map.entries()).sort(function (a, b) {
          return a[0].localeCompare(b[0])
        })
      )

      var startKey = Utilities.formatDate(now, timezone, 'yyyy-MM-dd')
      var lastIncludedDay = new Date(end.getTime() - 1)
      var endKey = Utilities.formatDate(lastIncludedDay, timezone, 'yyyy-MM-dd')
      var briefingTitle =
        'Weekly Briefing: ' +
        _formatDayLabelGAS_(startKey) +
        ' \u2013 ' +
        _formatDayLabelGAS_(endKey)

      _writeBriefingDocGAS_(doc, briefingTitle, grouped, timezone)
      Logger.log('[generateWeeklyBriefing] Briefing written for config #' + i)

      if (cfg.emailRecipients && cfg.emailRecipients.length) {
        var docId = typeof doc.getId === 'function' ? doc.getId() : doc.id || ''
        var docUrl = 'https://docs.google.com/document/d/' + docId + '/edit'
        var emailBody = 'Your weekly briefing is ready:\n\n' + docUrl
        for (var k = 0; k < cfg.emailRecipients.length; k++) {
          GmailApp.sendEmail(
            cfg.emailRecipients[k],
            cfg.emailSubject || 'Weekly Briefing',
            emailBody
          )
        }
      }
    } catch (e) {
      Logger.log('[generateWeeklyBriefing] Error for config #' + i + ': ' + e)
    }
  }
}

// Export for testing in Node environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getBriefingConfigs_,
    _formatDayLabelGAS_,
    _formatEventEntryGAS_,
    _detectConflictsGAS_,
    _formatConflictWarningGAS_,
    _writeBriefingDocGAS_,
    generateWeeklyBriefing,
  }
}
