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
      var aLabel = c.a.calendarName
        ? aTitle + ' (' + c.a.calendarName + ')'
        : aTitle
      var bLabel = c.b.calendarName
        ? bTitle + ' (' + c.b.calendarName + ')'
        : bTitle
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

/**
 * Formats the full briefing as a plain text string.
 * @param {string} title - Briefing title line
 * @param {Map} groupedEvents - Map of dateKey to event tuples/events
 * @param {string} timezone - IANA timezone string
 * @returns {string}
 */
function _formatBriefingGAS_(title, groupedEvents, timezone) {
  var sections = [title, '']

  for (var entry of groupedEvents.entries()) {
    var dateKey = entry[0]
    var items = entry[1]
    var dayLabel = _formatDayLabelGAS_(dateKey)
    sections.push(dayLabel)

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
      sections.push(warning)
    }

    var sorted = tuples.slice().sort(function (a, b) {
      return a.event.getStartTime().getTime() - b.event.getStartTime().getTime()
    })
    for (var i = 0; i < sorted.length; i++) {
      sections.push(
        _formatEventEntryGAS_(sorted[i].event, timezone, sorted[i].calendarName)
      )
    }

    sections.push('')
  }

  // Trim trailing whitespace
  var result = sections.join('\n')
  return result.replace(/\s+$/, '')
}

/**
 * Checks whether the briefing should run now based on schedule config.
 * Called every hour by the trigger; returns true only at the scheduled time.
 */
function _shouldRunNowGAS_(cfg, now, lastRunMs) {
  var hour = now.getHours()
  var scheduleHour = cfg.scheduleHour != null ? cfg.scheduleHour : 7
  if (hour !== scheduleHour) return false

  var frequency = cfg.scheduleFrequency || 'weekly'
  if (frequency === 'weekly') {
    var DAY_MAP = {
      SUNDAY: 0,
      MONDAY: 1,
      TUESDAY: 2,
      WEDNESDAY: 3,
      THURSDAY: 4,
      FRIDAY: 5,
      SATURDAY: 6,
    }
    var targetDay = DAY_MAP[cfg.scheduleDay || 'MONDAY']
    return now.getDay() === targetDay
  }
  if (frequency === 'days') {
    var intervalDays = cfg.scheduleIntervalDays || 1
    if (lastRunMs == null) return true
    var elapsed = now.getTime() - lastRunMs
    return elapsed / (24 * 60 * 60 * 1000) >= intervalDays
  }
  return true
}

/**
 * Main trigger function. Runs hourly via time-driven trigger.
 * Checks each config's schedule to determine whether to send the briefing.
 * Uses PropertiesService to track last run time per config index.
 */
function generateWeeklyBriefing() {
  var configs = getBriefingConfigs_()
  var timezone = Session.getScriptTimeZone()
  var props = PropertiesService.getUserProperties()

  for (var i = 0; i < configs.length; i++) {
    try {
      var cfg = configs[i]
      if (!cfg.emailRecipients || !cfg.emailRecipients.length) {
        Logger.log(
          '[generateWeeklyBriefing] Skipping config #' +
            i +
            ': missing emailRecipients'
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

      // Check schedule
      var now = new Date()
      var lastRunKey = 'briefing_lastRun_' + i
      var lastRunStr = props.getProperty(lastRunKey)
      var lastRunMs = lastRunStr ? parseInt(lastRunStr, 10) : null
      if (!_shouldRunNowGAS_(cfg, now, lastRunMs)) {
        continue
      }

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

      var briefingText = _formatBriefingGAS_(briefingTitle, grouped, timezone)
      Logger.log('[generateWeeklyBriefing] Briefing formatted for config #' + i)

      for (var k = 0; k < cfg.emailRecipients.length; k++) {
        GmailApp.sendEmail(
          cfg.emailRecipients[k],
          cfg.emailSubject || 'Weekly Briefing',
          briefingText
        )
      }

      // Record successful run time
      props.setProperty(lastRunKey, String(new Date().getTime()))
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
    _formatBriefingGAS_,
    _shouldRunNowGAS_,
    generateWeeklyBriefing,
  }
}
