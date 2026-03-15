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

function _formatEventEntryGAS_(event, timezone) {
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

function _writeBriefingDocGAS_(doc, title, groupedEvents, timezone) {
  var body = doc.getBody()
  body.clear()

  var titlePara = body.appendParagraph(title)
  var boldAttr = {}
  boldAttr[DocumentApp.Attribute.BOLD] = true
  titlePara.setAttributes(boldAttr)

  for (var entry of groupedEvents.entries()) {
    var dateKey = entry[0]
    var events = entry[1]
    var dayLabel = _formatDayLabelGAS_(dateKey)
    var heading = body.appendParagraph(dayLabel)
    heading.setHeading(DocumentApp.ParagraphHeading.HEADING_3)

    var sorted = events.slice().sort(function (a, b) {
      return a.getStartTime().getTime() - b.getStartTime().getTime()
    })
    for (var i = 0; i < sorted.length; i++) {
      body.appendParagraph(_formatEventEntryGAS_(sorted[i], timezone))
    }
  }
}

/**
 * Main trigger function. Schedule via a weekly time-driven trigger
 * (e.g., every Monday at 7 AM) using the deploy page's setup.gs.
 */
function generateWeeklyBriefing() {
  var configs = getBriefingConfigs_()
  var timezone = Session.getScriptTimeZone()

  for (var i = 0; i < configs.length; i++) {
    try {
      var cfg = configs[i]
      if (!cfg.calendarId || !cfg.docId) {
        Logger.log(
          '[generateWeeklyBriefing] Skipping config #' +
            i +
            ': missing calendarId or docId'
        )
        continue
      }

      var calendar = CalendarApp.getCalendarById(cfg.calendarId)
      var doc = DocumentApp.openById(cfg.docId)
      var now = new Date()
      var lookaheadMs = (cfg.lookaheadDays || 7) * 24 * 60 * 60 * 1000
      var end = new Date(now.getTime() + lookaheadMs)
      var events = calendar.getEvents(now, end)

      // Group events by day
      var map = new Map()
      for (var j = 0; j < events.length; j++) {
        var key = Utilities.formatDate(
          events[j].getStartTime(),
          timezone,
          'yyyy-MM-dd'
        )
        if (!map.has(key)) map.set(key, [])
        map.get(key).push(events[j])
      }
      var grouped = new Map(
        Array.from(map.entries()).sort(function (a, b) {
          return a[0].localeCompare(b[0])
        })
      )

      var startKey = Utilities.formatDate(now, timezone, 'yyyy-MM-dd')
      var endKey = Utilities.formatDate(end, timezone, 'yyyy-MM-dd')
      var briefingTitle =
        'Weekly Briefing: ' +
        _formatDayLabelGAS_(startKey) +
        ' \u2013 ' +
        _formatDayLabelGAS_(endKey)

      _writeBriefingDocGAS_(doc, briefingTitle, grouped, timezone)
      Logger.log(
        '[generateWeeklyBriefing] Briefing written for calendar: ' +
          cfg.calendarId
      )

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
    _writeBriefingDocGAS_,
    generateWeeklyBriefing,
  }
}
