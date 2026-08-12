const { getRetentionConfig } = require('../config.gs')

describe('gmail-retention-policy config', () => {
  beforeEach(() => {
    global.Session = {
      getEffectiveUser: jest.fn(() => ({
        getEmail: () => 'testuser@example.com',
      })),
    }
  })

  test('getRetentionConfig returns effective user email and standard rules', () => {
    const config = getRetentionConfig()
    expect(config.userAccountEmail).toBe('testuser@example.com')
    expect(config.classificationRules.length).toBeGreaterThan(0)
    expect(config.executionRules.length).toBeGreaterThan(0)
  })

  test('getRetentionConfig falls back when getEmail is empty', () => {
    global.Session = {
      getEffectiveUser: jest.fn(() => ({
        getEmail: () => '',
      })),
    }
    const config = getRetentionConfig()
    expect(config.userAccountEmail).toBe('user@example.com')
  })
})
