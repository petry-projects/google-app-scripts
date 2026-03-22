/**
 * Calendar to Briefing Doc configuration.
 * Supports multiple briefing configurations.
 * Update values when deploying in Google Apps Script.
 *
 * The script runs on an hourly trigger and uses the schedule fields
 * below to decide when to actually send the briefing email.
 *
 * Example:
 * var BRIEFING_CONFIGS = [
 *   {
 *     useAllCalendars: true,
 *     excludeCalendars: [],
 *     emailRecipients: ['you@example.com'],
 *     emailSubject: 'Weekly Briefing',
 *     lookaheadDays: 7,
 *     scheduleFrequency: 'weekly',
 *     scheduleDay: 'MONDAY',
 *     scheduleHour: 7,
 *   },
 * ]
 */

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
