/**
 * Configuration for Gmail AI Classifier & Auto-Filter Engine
 */
function getAiClassifierConfig() {
  return {
    // Gemini API Key (stored in ScriptProperties or set here)
    geminiApiKey: PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || 'YOUR_GEMINI_API_KEY',

    // Model Endpoint (Gemini 1.5 Flash / Gemini 2.0 Flash)
    modelEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',

    // Trigger Label applied to unprocessed inbox items
    unprocessedQuery: 'inbox -label:Processed',

    // Single Global Ingestion Marker Label
    processedLabel: 'Processed',

    // Minimum confidence threshold (0.0 - 1.0) required to auto-create permanent Gmail filter rules
    autoFilterConfidenceThreshold: 0.95,

    // 7 Canonical Domains for Semantic Classification
    canonicalDomains: [
      '01_Household/Primary_House',
      '01_Household/Shop_Build',
      '01_Household/Rental_3535_Broken_Bow',
      '01_Household/Archive_18_Running_Deer',
      '02_Finance_Legal/Taxes',
      '02_Finance_Legal/Insurance',
      '02_Finance_Legal/Banking',
      '02_Finance_Legal/Legal_Court',
      '02_Finance_Legal/Estate_Planning',
      '03_Vehicles/Car_Hunt',
      '03_Vehicles/Mercedes',
      '03_Vehicles/Maintenance',
      '04_Family_Health/Bowens',
      '04_Family_Health/Charley',
      '04_Family_Health/David',
      '04_Family_Health/DJ',
      '04_Family_Health/Medical_Records',
      '04_Family_Health/Activities_AYOP_Camps',
      '05_Tech_Infrastructure/NAS_Backups',
      '05_Tech_Infrastructure/Tasker',
      '05_Tech_Infrastructure/Hardware_Licenses',
      '06_Work_Career/EY',
      '06_Work_Career/Career_Interviews',
      '06_Work_Career/Expenses_Admin',
      '07_Community_NonProfit/HelpingOneGuy',
      '07_Community_NonProfit/JeffCo_Bees'
    ]
  };
}
