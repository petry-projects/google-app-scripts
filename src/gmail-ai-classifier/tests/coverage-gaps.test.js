const {
  setGmailCategoryTab,
  cleanConflictingLabels,
  processThreadBatch,
  getNotePathForDomain,
  resolveTaxonomySubfolderName,
  evaluateAttachmentEligibility,
  getMessageAttachments_,
} = require('../src/index.js')

const makeLabel = (name) => ({ getName: () => name })

const makeThread = (labels = []) => ({
  getId: () => 't1',
  getLabels: () => labels.map(makeLabel),
  removeLabel: jest.fn(),
  addLabel: jest.fn(),
})

describe('setGmailCategoryTab failure handling', () => {
  test('warns and does not throw when Threads.modify fails', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const gmail = {
      Users: {
        Threads: {
          modify: jest.fn(() => {
            throw new Error('quota exceeded')
          }),
        },
      },
    }
    expect(() =>
      setGmailCategoryTab(makeThread(), 'Updates', gmail)
    ).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('quota exceeded'))
    warn.mockRestore()
  })

  test('logs thread id when subject accessor is missing', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    const gmail = { Users: { Threads: { modify: jest.fn() } } }
    setGmailCategoryTab(makeThread(), 'Social', gmail)
    expect(gmail.Users.Threads.modify).toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('t1'))
    log.mockRestore()
  })
})

describe('cleanConflictingLabels', () => {
  test('removes custom configured domain labels that are not root-like', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    const thread = makeThread(['CustomDomain', 'Processed'])
    cleanConflictingLabels(thread, 'CustomDomain', null, {
      canonicalDomains: ['CustomDomain'],
      processedLabel: 'Processed',
    })
    expect(thread.removeLabel).toHaveBeenCalledTimes(1)
    expect(thread.removeLabel.mock.calls[0][0].getName()).toBe('CustomDomain')
    log.mockRestore()
  })

  test('warns when the thread label lookup throws', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const thread = {
      getLabels: () => {
        throw new Error('boom')
      },
    }
    cleanConflictingLabels(thread, 'x', 'y', {})
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'))
    warn.mockRestore()
  })
})

describe('processThreadBatch fallback tag resolution', () => {
  const config = {
    modelEndpoint: 'https://example.invalid/model',
    geminiApiKey: '',
    processedLabel: 'Processed',
    autoFilterConfidenceThreshold: 0.99,
    canonicalDomains: ['01_Unmapped'],
  }
  const geminiResponse = (classification) => ({
    getResponseCode: () => 200,
    getContentText: () =>
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text: JSON.stringify(classification) }] } },
        ],
      }),
  })

  test('drops a root-like domain with no default sub-label mapping', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    const thread = {
      ...makeThread(),
      getMessages: () => [
        {
          getFrom: () => 'a@example.com',
          getSubject: () => 's',
          getPlainBody: () => 'a sufficiently long body for the snippet',
        },
      ],
    }
    const getUserLabelByName = jest.fn((n) => makeLabel(n))
    const services = {
      GmailApp: { getUserLabelByName, createLabel: jest.fn() },
      UrlFetchApp: {
        fetch: jest.fn(() =>
          geminiResponse({
            canonical_label: '01_Unmapped',
            confidence: 0.5,
            reasoning: 'r',
          })
        ),
      },
      Gmail: null,
    }
    const results = processThreadBatch([thread], config, services)
    expect(results[0].status).toBe('classified')
    // only the Processed label is added; no category label for root domain
    expect(thread.addLabel).toHaveBeenCalledTimes(1)
    expect(getUserLabelByName).not.toHaveBeenCalledWith('01_Unmapped')
    log.mockRestore()
  })
})

describe('getNotePathForDomain custom paths', () => {
  afterEach(() => {
    delete global.PropertiesService
  })

  test('uses CUSTOM_NOTE_PATHS override when present', () => {
    global.PropertiesService = {
      getScriptProperties: () => ({
        getProperty: () => JSON.stringify({ '01_Household': 'custom/home.md' }),
      }),
    }
    expect(getNotePathForDomain('01_Household')).toBe('custom/home.md')
  })

  test('falls back to defaults on malformed JSON', () => {
    global.PropertiesService = {
      getScriptProperties: () => ({ getProperty: () => '{not json' }),
    }
    expect(getNotePathForDomain('01_Household')).toBe('01_Household/index.md')
  })

  test('falls back to defaults when domain not in custom map', () => {
    global.PropertiesService = {
      getScriptProperties: () => ({ getProperty: () => '{}' }),
    }
    expect(getNotePathForDomain('03_Vehicles')).toBe('03_Vehicles/index.md')
    expect(getNotePathForDomain('nope')).toBeNull()
  })
})

describe('resolveTaxonomySubfolderName family special cases', () => {
  test('family/kids maps to Students or Medical_Records', () => {
    expect(
      resolveTaxonomySubfolderName('04_Family_Health', 'Family/Kids')
    ).toBe('Students')
    expect(
      resolveTaxonomySubfolderName('04_Family_Health', 'Family/Kids-Health')
    ).toBe('Medical_Records')
    expect(
      resolveTaxonomySubfolderName('04_Family_Health', 'Family/Kids Medical')
    ).toBe('Medical_Records')
  })

  test('unlisted family/kids and family/sisters sub-paths use prefix rules', () => {
    const d = '04_Family_Health'
    expect(resolveTaxonomySubfolderName(d, 'Family/Kids/Other')).toBe(
      'Students'
    )
    expect(resolveTaxonomySubfolderName(d, 'Family/Kids/Other-Health')).toBe(
      'Medical_Records'
    )
    expect(resolveTaxonomySubfolderName(d, 'Family/Sisters/Extra')).toBe(
      'Family_General'
    )
  })

  test('family/sisters maps to Family_General', () => {
    expect(
      resolveTaxonomySubfolderName('04_Family_Health', 'Family/Sisters')
    ).toBe('Family_General')
  })
})

describe('evaluateAttachmentEligibility edge cases', () => {
  const att = (name) => ({ name, size: 100 })

  test('blocks winmail.dat and smime.p7s mail artifacts', () => {
    expect(evaluateAttachmentEligibility(att('winmail.dat')).eligible).toBe(
      false
    )
    expect(evaluateAttachmentEligibility(att('smime.p7s')).eligible).toBe(false)
  })

  test('rejects boilerplate text files but accepts substantial ones', () => {
    expect(evaluateAttachmentEligibility(att('Disclaimer.txt'))).toEqual({
      eligible: false,
      reason: 'TEXT_BOILERPLATE_DISCLAIMER',
    })
    expect(evaluateAttachmentEligibility(att('notes.txt')).eligible).toBe(true)
  })

  test('rejects unknown extensions', () => {
    expect(evaluateAttachmentEligibility(att('data.qqq'))).toEqual({
      eligible: false,
      reason: 'UNKNOWN_OR_UNSUPPORTED_EXTENSION:.qqq',
    })
  })
})

describe('getMessageAttachments_ fallbacks', () => {
  test('retries without options when the options call throws', () => {
    const msg = {
      getAttachments: jest.fn((opts) => {
        if (opts) throw new Error('unsupported')
        return ['a']
      }),
    }
    expect(getMessageAttachments_(msg)).toEqual(['a'])
    expect(msg.getAttachments).toHaveBeenCalledTimes(2)
  })
})
