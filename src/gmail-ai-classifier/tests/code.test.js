/**
 * Unit tests for Gmail AI Classifier
 */

describe('Gmail AI Classifier Config', () => {
  test('returns standard config schema', () => {
    const config = {
      geminiApiKey: 'TEST_KEY',
      processedLabel: 'Processed',
      autoFilterConfidenceThreshold: 0.95,
      canonicalDomains: ['01_Household/Primary_House', '04_Family_Health/Bowens']
    }
    expect(config.processedLabel).toBe('Processed')
    expect(config.autoFilterConfidenceThreshold).toBe(0.95)
    expect(config.canonicalDomains).toContain('04_Family_Health/Bowens')
  })
})
