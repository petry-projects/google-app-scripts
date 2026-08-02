/**
 * Configuration schema for Tag-Based Gmail Retention & Taxonomy Automation
 * Sanitized Open-Source Template (100% PII Redacted)
 */

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
        query: 'category:social -family@example.com -friend@example.com',
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
          'category:updates (from:notifications@example.com OR from:alerts@*) -bank -invoice -receipt -bill -billing -payment -statement -tax -order -purchase',
      },
      {
        taxonomyLabel: 'Travel/Bookings',
        retentionTag: 'Retention/3-Years',
        query: 'from:travel-provider@example.com',
      },
      {
        taxonomyLabel: 'Family/Personal',
        retentionTag: 'Retention/Permanent',
        query: 'from:(family@example.com OR relative@example.com)',
      },
      {
        taxonomyLabel: 'Finance/Purchases',
        retentionTag: 'Retention/Permanent',
        query: 'from:(bank@example.com OR store-receipts@example.com)',
      },
      {
        taxonomyLabel: 'Work/Core',
        retentionTag: 'Retention/Archive-60-Days',
        query: 'from:work-domain.com OR to:work-domain.com',
      },
    ],

    // Stage 2 Execution Rules
    executionRules: [
      {
        tag: 'Retention/30-Days',
        action: 'trash',
        query: 'label:Retention/30-Days older_than:30d',
      },
      {
        tag: 'Retention/90-Days',
        action: 'trash',
        query: 'label:Retention/90-Days older_than:90d',
      },
      {
        tag: 'Retention/1-Year',
        action: 'trash',
        query: 'label:Retention/1-Year older_than:1y',
      },
      {
        tag: 'Retention/2-Years',
        action: 'trash',
        query: 'label:Retention/2-Years older_than:2y',
      },
      {
        tag: 'Retention/3-Years',
        action: 'trash',
        query: 'label:Retention/3-Years older_than:3y',
      },
      {
        tag: 'Retention/Archive-60-Days',
        action: 'archive',
        query: 'label:Retention/Archive-60-Days older_than:60d is:inbox',
      },
    ],
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getRetentionConfig }
}
