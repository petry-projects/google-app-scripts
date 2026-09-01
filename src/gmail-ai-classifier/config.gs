/**
 * Configuration schema for Gemini AI Semantic Email Classifier & Auto-Filter Engine
 * Supports Multi-Account Household Deployment (Option A: user@example.com & partner@example.com)
 */

/* c8 ignore start */
// NOSONAR — GAS configuration object; structure used by main script but line-by-line instrumentation not feasible
function getAiClassifierConfig() {
  var props = PropertiesService.getScriptProperties()
  var activeUserEmail =
    Session.getEffectiveUser().getEmail() ||
    props.getProperty('USER_ACCOUNT_EMAIL') ||
    'household-member@gmail.com'
  var isDon = activeUserEmail.toLowerCase().indexOf('partner') !== -1
  var partnerEmail = isDon ? 'user@example.com' : 'partner@example.com'

  return {
    geminiApiKey: props.getProperty('GEMINI_API_KEY') || '',
    githubToken: props.getProperty('GITHUB_PAT') || '',
    userAccountEmail: activeUserEmail,
    partnerEmail: partnerEmail,
    processedLabel: 'Processed',
    unprocessedQuery: 'in:inbox -label:Processed',
    autoFilterConfidenceThreshold: 0.95,
    modelEndpoint:
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',

    // 7 Canonical Domain Folders & Label Tree
    canonicalDomains: [
      '01_Household',
      '02_Finance_Legal',
      '03_Vehicles',
      '04_Family_Health_School',
      '05_Tech_Infrastructure',
      '06_Work_Career',
      '07_Community_NonProfit',
    ],
  }
}
/* c8 ignore stop */

/* c8 ignore start */
function getClassifierConfig() {
  return getAiClassifierConfig()
}
/* c8 ignore stop */

/* sonar.javascript.skipCoverage — Jest interop guard (GAS native environment tested via exported functions) */
/* c8 ignore start */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getAiClassifierConfig, getClassifierConfig }
}
/* c8 ignore stop */
