/**
 * Calendar to Briefing Doc configuration.
 * Supports multiple calendar-to-doc mappings.
 * Update values when deploying in Google Apps Script.
 *
 * Example:
 * var BRIEFING_CONFIGS = [
 *   {
 *     calendarId: 'primary',
 *     docId: 'YOUR_GOOGLE_DOC_ID',
 *     lookaheadDays: 7,
 *     emailRecipients: ['you@example.com'],
 *     emailSubject: 'Weekly Briefing',
 *   },
 * ]
 */

var BRIEFING_CONFIGS = [
  {
    calendarId: '',
    docId: '',
    lookaheadDays: 7,
    emailRecipients: [],
    emailSubject: 'Weekly Briefing',
  },
]
