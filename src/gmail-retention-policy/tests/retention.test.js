const { getRetentionConfig } = require('../config.js')
const {
  classifyAndTagThreads,
  executeRetentionRules,
  getOrCreateLabel,
  createAndManageTrigger,
} = require('../src/index.js')

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

  test('classification rules have required structure', () => {
    const config = getRetentionConfig()
    config.classificationRules.forEach((rule) => {
      expect(rule).toHaveProperty('taxonomyLabel')
      expect(rule).toHaveProperty('retentionTag')
      expect(rule).toHaveProperty('query')
      expect(typeof rule.taxonomyLabel).toBe('string')
      expect(typeof rule.retentionTag).toBe('string')
      expect(typeof rule.query).toBe('string')
    })
  })

  test('execution rules have required structure', () => {
    const config = getRetentionConfig()
    config.executionRules.forEach((rule) => {
      expect(rule).toHaveProperty('tag')
      expect(rule).toHaveProperty('action')
      expect(rule).toHaveProperty('query')
      expect(typeof rule.tag).toBe('string')
      expect(['trash', 'archive']).toContain(rule.action)
      expect(typeof rule.query).toBe('string')
    })
  })
})

describe('gmail-retention-policy business logic', () => {
  let mockGmailApp, mockLogger, mockLabel

  beforeEach(() => {
    mockLabel = {
      addToThreads: jest.fn(),
    }

    mockGmailApp = {
      search: jest.fn(),
      getUserLabelByName: jest.fn(),
      createLabel: jest.fn(() => mockLabel),
      moveThreadsToTrash: jest.fn(),
      moveThreadsToArchive: jest.fn(),
    }

    mockLogger = {
      log: jest.fn(),
    }
  })

  describe('getOrCreateLabel', () => {
    test('returns existing label if found', () => {
      mockGmailApp.getUserLabelByName.mockReturnValue(mockLabel)

      const label = getOrCreateLabel('Existing/Label', mockGmailApp, mockLogger)

      expect(label).toBe(mockLabel)
      expect(mockGmailApp.getUserLabelByName).toHaveBeenCalledWith(
        'Existing/Label'
      )
      expect(mockGmailApp.createLabel).not.toHaveBeenCalled()
    })

    test('creates new label if not found', () => {
      mockGmailApp.getUserLabelByName.mockReturnValue(null)

      const label = getOrCreateLabel('New/Label', mockGmailApp, mockLogger)

      expect(label).toBe(mockLabel)
      expect(mockGmailApp.createLabel).toHaveBeenCalledWith('New/Label')
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Creating new label')
      )
    })
  })

  describe('classifyAndTagThreads', () => {
    test('sorts threads by last message date before processing', () => {
      const mockDate1 = new Date('2025-01-01')
      const mockDate2 = new Date('2025-01-02')
      const mockDate3 = new Date('2025-01-03')
      const mockThread1 = { id: '1', getLastMessageDate: () => mockDate1 }
      const mockThread2 = { id: '2', getLastMessageDate: () => mockDate2 }
      const mockThread3 = { id: '3', getLastMessageDate: () => mockDate3 }
      mockGmailApp.search.mockReturnValue([
        mockThread1,
        mockThread3,
        mockThread2,
      ])
      mockGmailApp.getUserLabelByName.mockReturnValue(null)

      const rules = [
        {
          taxonomyLabel: 'TestLabel',
          retentionTag: 'Retention/Test',
          query: 'from:test@example.com',
        },
      ]

      classifyAndTagThreads(rules, mockGmailApp, mockLogger)

      expect(mockLabel.addToThreads).toHaveBeenCalledWith([
        mockThread3,
        mockThread2,
        mockThread1,
      ])
    })

    test('tags threads with taxonomy and retention labels', () => {
      const mockThread1 = {
        id: '1',
        getLastMessageDate: () => new Date('2025-01-01'),
      }
      const mockThread2 = {
        id: '2',
        getLastMessageDate: () => new Date('2025-01-02'),
      }
      mockGmailApp.search.mockReturnValue([mockThread1, mockThread2])
      mockGmailApp.getUserLabelByName.mockReturnValue(null)

      const rules = [
        {
          taxonomyLabel: 'Newsletters',
          retentionTag: 'Retention/30-Days',
          query: 'from:newsletter@example.com',
        },
      ]

      classifyAndTagThreads(rules, mockGmailApp, mockLogger)

      expect(mockGmailApp.search).toHaveBeenCalledWith(
        '(from:newsletter@example.com) -label:"Newsletters"',
        0,
        50
      )
      expect(mockGmailApp.createLabel).toHaveBeenCalledTimes(2)
      expect(mockLabel.addToThreads).toHaveBeenCalledTimes(2)
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Tagging 2 threads')
      )
    })

    test('skips empty search results', () => {
      mockGmailApp.search.mockReturnValue([])

      const rules = [
        {
          taxonomyLabel: 'TestLabel',
          retentionTag: 'Retention/Test',
          query: 'from:test@example.com',
        },
      ]

      classifyAndTagThreads(rules, mockGmailApp, mockLogger)

      expect(mockLabel.addToThreads).not.toHaveBeenCalled()
      expect(mockGmailApp.createLabel).not.toHaveBeenCalled()
    })

    test('processes multiple rules in sequence', () => {
      const mockThread = {
        id: '1',
        getLastMessageDate: () => new Date('2025-01-01'),
      }
      mockGmailApp.search.mockReturnValue([mockThread])
      mockGmailApp.getUserLabelByName.mockReturnValue(null)

      const rules = [
        {
          taxonomyLabel: 'Rule1',
          retentionTag: 'Retention/1',
          query: 'query1',
        },
        {
          taxonomyLabel: 'Rule2',
          retentionTag: 'Retention/2',
          query: 'query2',
        },
      ]

      classifyAndTagThreads(rules, mockGmailApp, mockLogger)

      expect(mockGmailApp.search).toHaveBeenCalledTimes(2)
      expect(mockGmailApp.createLabel).toHaveBeenCalledTimes(4)
    })
  })

  describe('executeRetentionRules', () => {
    test('trashes threads matching trash action', () => {
      const mockThread1 = {
        getLastMessageDate: () => new Date('2025-01-01'),
      }
      const mockThread2 = {
        getLastMessageDate: () => new Date('2025-01-02'),
      }
      mockGmailApp.search.mockReturnValue([mockThread1, mockThread2])

      const rules = [
        {
          tag: 'Retention/30-Days',
          action: 'trash',
          query: 'label:Retention/30-Days older_than:30d',
        },
      ]

      executeRetentionRules(rules, mockGmailApp, mockLogger)

      expect(mockGmailApp.moveThreadsToTrash).toHaveBeenCalledWith([
        mockThread2,
        mockThread1,
      ])
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Trashing 2 threads')
      )
    })

    test('archives threads matching archive action', () => {
      const mockThread1 = {
        getLastMessageDate: () => new Date('2025-01-01'),
      }
      const mockThread2 = {
        getLastMessageDate: () => new Date('2025-01-02'),
      }
      mockGmailApp.search.mockReturnValue([mockThread1, mockThread2])

      const rules = [
        {
          tag: 'Retention/Archive',
          action: 'archive',
          query: 'label:Retention/Archive is:inbox',
        },
      ]

      executeRetentionRules(rules, mockGmailApp, mockLogger)

      expect(mockGmailApp.moveThreadsToArchive).toHaveBeenCalledWith([
        mockThread2,
        mockThread1,
      ])
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Archiving 2 threads')
      )
    })

    test('ignores rules with no matching threads', () => {
      mockGmailApp.search.mockReturnValue([])

      const rules = [
        {
          tag: 'Retention/Test',
          action: 'trash',
          query: 'label:Retention/Test older_than:1d',
        },
      ]

      executeRetentionRules(rules, mockGmailApp, mockLogger)

      expect(mockLogger.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Trashing')
      )
    })

    test('handles unknown actions gracefully', () => {
      const mockThread = {
        getLastMessageDate: () => new Date('2025-01-01'),
      }
      mockGmailApp.search.mockReturnValue([mockThread])

      const rules = [
        {
          tag: 'Retention/Unknown',
          action: 'unknown_action',
          query: 'some:query',
        },
      ]

      executeRetentionRules(rules, mockGmailApp, mockLogger)

      expect(mockGmailApp.moveThreadsToArchive).not.toHaveBeenCalled()
      expect(mockGmailApp.moveThreadsToTrash).not.toHaveBeenCalled()
    })
  })

  describe('createAndManageTrigger', () => {
    let mockScriptApp

    beforeEach(() => {
      mockScriptApp = {
        getProjectTriggers: jest.fn(),
        deleteTrigger: jest.fn(),
        newTrigger: jest.fn(),
      }
    })

    test('removes old trigger and creates new hourly trigger', () => {
      const mockOldTrigger = {
        getHandlerFunction: jest.fn(() => 'testHandler'),
      }
      mockScriptApp.getProjectTriggers.mockReturnValue([mockOldTrigger])

      const mockTriggerBuilder = {
        timeBased: jest.fn(() => ({
          everyHours: jest.fn(() => ({
            create: jest.fn(),
          })),
        })),
      }
      mockScriptApp.newTrigger.mockReturnValue(mockTriggerBuilder)

      createAndManageTrigger(mockScriptApp, mockLogger, 'testHandler')

      expect(mockScriptApp.deleteTrigger).toHaveBeenCalledWith(mockOldTrigger)
      expect(mockScriptApp.newTrigger).toHaveBeenCalledWith('testHandler')
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Removed old trigger')
      )
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Hourly trigger created')
      )
    })

    test('creates trigger when no existing trigger found', () => {
      mockScriptApp.getProjectTriggers.mockReturnValue([])

      const mockTriggerBuilder = {
        timeBased: jest.fn(() => ({
          everyHours: jest.fn(() => ({
            create: jest.fn(),
          })),
        })),
      }
      mockScriptApp.newTrigger.mockReturnValue(mockTriggerBuilder)

      createAndManageTrigger(mockScriptApp, mockLogger, 'testHandler')

      expect(mockScriptApp.deleteTrigger).not.toHaveBeenCalled()
      expect(mockScriptApp.newTrigger).toHaveBeenCalledWith('testHandler')
    })

    test('skips old triggers with different handler function', () => {
      const mockOtherTrigger = {
        getHandlerFunction: jest.fn(() => 'otherHandler'),
      }
      mockScriptApp.getProjectTriggers.mockReturnValue([mockOtherTrigger])

      const mockTriggerBuilder = {
        timeBased: jest.fn(() => ({
          everyHours: jest.fn(() => ({
            create: jest.fn(),
          })),
        })),
      }
      mockScriptApp.newTrigger.mockReturnValue(mockTriggerBuilder)

      createAndManageTrigger(mockScriptApp, mockLogger, 'testHandler')

      expect(mockScriptApp.deleteTrigger).not.toHaveBeenCalled()
    })

    test('processRulesForThreads is exported and callable', () => {
      const { processRulesForThreads } = require('../src/index.js')
      expect(typeof processRulesForThreads).toBe('function')
    })
  })

  describe('GAS entry points wiring', () => {
    beforeEach(() => {
      global.Session = {
        getEffectiveUser: jest.fn(() => ({
          getEmail: () => 'testuser@example.com',
        })),
      }
    })

    test('code.gs: runGmailRetentionAutomation integration with config', () => {
      const config = getRetentionConfig()
      expect(config.classificationRules.length).toBeGreaterThan(0)
      expect(config.executionRules.length).toBeGreaterThan(0)
      expect(config.userAccountEmail).toBe('testuser@example.com')
    })

    test('code.gs: createHourlyTrigger calls createAndManageTrigger with correct handler', () => {
      const mockScriptApp = {
        getProjectTriggers: jest.fn(() => []),
        deleteTrigger: jest.fn(),
        newTrigger: jest.fn(() => ({
          timeBased: jest.fn(() => ({
            everyHours: jest.fn(() => ({
              create: jest.fn(),
            })),
          })),
        })),
      }
      createAndManageTrigger(
        mockScriptApp,
        mockLogger,
        'runGmailRetentionAutomation'
      )
      expect(mockScriptApp.newTrigger).toHaveBeenCalledWith(
        'runGmailRetentionAutomation'
      )
    })
  })
})
