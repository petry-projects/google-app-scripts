/**
 * Configuration schema for Tag-Based Gmail Retention & Taxonomy Automation
 * Sanitized Open-Source Template (100% PII Redacted)
 */

// NOSONAR — configuration data contains intentionally repetitive rule objects with similar structure
function getRetentionConfig() {
  return {
    userAccountEmail:
      Session.getEffectiveUser().getEmail() || 'user@example.com',

    // 2-Stage Tag-Based Retention Classification Rules
    classificationRules: [
      {
        taxonomyLabel: 'Subscriptions/Newsletters',
        retentionTag: 'Retention/30-Days',
        query:
          'from:(newsletters@example.com OR daily-news@example.com OR digest@example.com)',
      },
      {
        taxonomyLabel: 'Social/Broadcasts',
        retentionTag: 'Retention/30-Days',
        query:
          'category:social -from:family@example.com -from:friend@example.com',
      },
      {
        taxonomyLabel: 'Promotions/Retail',
        retentionTag: 'Retention/90-Days',
        query:
          'category:promotions -invoice -receipt -bill -billing -payment -statement -tax -order -purchase -bank -chase -paypal -venmo -square -stripe -amount -confirmation',
      },
      {
        taxonomyLabel: 'Forums/Newsletters',
        retentionTag: 'Retention/1-Year',
        query:
          'category:forums -invoice -receipt -bill -billing -payment -statement -tax -order -purchase -bank -chase -paypal -venmo -square -stripe -amount -confirmation',
      },
      {
        taxonomyLabel: 'System/Alerts',
        retentionTag: 'Retention/2-Years',
        query:
          'category:updates from:notifications@example.com -bank -invoice -receipt -bill -billing -payment -statement -tax -order -purchase',
      },
      {
        taxonomyLabel: 'Travel/Bookings',
        retentionTag: 'Retention/3-Years',
        query: 'from:travel-provider@example.com',
      },
      {
        taxonomyLabel: 'Family/Personal-Health',
        retentionTag: 'Retention/Permanent',
        query: 'from:(health-provider@example.com OR wellness@example.com)',
      },
      {
        taxonomyLabel: 'Family/Kids/Camp',
        retentionTag: 'Retention/Permanent',
        query: 'from:camp-provider@example.com',
      },
      {
        taxonomyLabel: 'Projects/Business',
        retentionTag: 'Retention/Archive-60-Days',
        query: 'from:business-supplies@example.com OR from:etsy.com',
      },
      {
        taxonomyLabel: 'Finance/Purchases',
        retentionTag: 'Retention/Permanent',
        query:
          'from:(store@example.com OR merchant@example.com) ("receipt" OR "order" OR "shipped" OR "delivered")',
      },
      {
        taxonomyLabel: 'Finance/Bills',
        retentionTag: 'Retention/Permanent',
        query:
          'from:utility@example.com ("statement" OR "bill" OR "payment" OR "due")',
      },
      {
        taxonomyLabel: 'Work/Core',
        retentionTag: 'Retention/Archive-60-Days',
        query:
          '(from:work-domain.com OR to:work-domain.com) -label:Retention/*',
      },
    ],

    // Stage 2 Execution Rules
    executionRules: [
      {
        tag: 'Retention/30-Days',
        action: 'trash',
        query:
          'label:Retention/30-Days older_than:30d -label:Retention/Permanent',
      },
      {
        tag: 'Retention/90-Days',
        action: 'trash',
        query:
          'label:Retention/90-Days older_than:90d -label:Retention/Permanent',
      },
      {
        tag: 'Retention/1-Year',
        action: 'trash',
        query:
          'label:Retention/1-Year older_than:1y -label:Retention/Permanent',
      },
      {
        tag: 'Retention/2-Years',
        action: 'trash',
        query:
          'label:Retention/2-Years older_than:2y -label:Retention/Permanent',
      },
      {
        tag: 'Retention/3-Years',
        action: 'trash',
        query:
          'label:Retention/3-Years older_than:3y -label:Retention/Permanent',
      },
      {
        tag: 'Retention/Archive-60-Days',
        action: 'archive',
        query: 'label:Retention/Archive-60-Days older_than:60d is:inbox',
      },
    ],
  }
}

/* c8 ignore start */
// NOSONAR — Jest interop guard for test environment, not executed in GAS runtime
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getRetentionConfig }
}
/* c8 ignore stop */
