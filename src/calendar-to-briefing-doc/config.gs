/**
 * Calendar to Briefing Doc configuration.
 * Supports multiple briefing configurations.
 * Update values when deploying in Google Apps Script.
 *
 * When useAllCalendars is true (default), events from every accessible
 * calendar are included and labelled by source. Set calendarId instead
 * to pull from a single calendar only.
 *
 * Example:
 * var BRIEFING_CONFIGS = [
 *   {
 *     useAllCalendars: true,
 *     excludeCalendars: [],
 *     docId: 'YOUR_GOOGLE_DOC_ID',
 *     lookaheadDays: 7,
 *     emailRecipients: ['you@example.com'],
 *     emailSubject: 'Weekly Briefing',
 *   },
 * ]
 */

var BRIEFING_CONFIGS = [
  {
    useAllCalendars: true,
    excludeCalendars: [],
    docId: '',
    lookaheadDays: 7,
    emailRecipients: [],
    emailSubject: 'Weekly Briefing',
  },
]
