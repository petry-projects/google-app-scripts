/**
 * Configuration schema for Google Drive AI Ingestion Engine
 * Monitors 7 Canonical Folders, applies Dual-Layer Hybrid Tags, and syncs to GitHub.
 */

function getDriveIngesterConfig() {
  var props = PropertiesService.getScriptProperties()

  return {
    geminiApiKey: props.getProperty('GEMINI_API_KEY') || '',
    githubToken: props.getProperty('GITHUB_PAT') || '',
    userAccountEmail:
      Session.getEffectiveUser().getEmail() ||
      props.getProperty('USER_ACCOUNT_EMAIL') ||
      'user@example.com',

    // 7 Canonical Domain Folders & Label Tree
    canonicalDomains: [
      '01_Household',
      '02_Finance_Legal',
      '03_Vehicles',
      '04_Family_Health',
      '05_Tech_Infrastructure',
      '06_Work_Career',
      '07_Community_NonProfit',
    ],
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getDriveIngesterConfig: getDriveIngesterConfig }
}
