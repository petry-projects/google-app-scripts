const {
  validateClassification,
  classifyEmailWithGemini,
  ensureGmailLabel,
  createPermanentGmailFilter,
  processThreadBatch,
} = require('../src/index.js')

const TEST_DOMAINS = [
  '01_Household/Primary_House',
  '02_Finance_Legal/Taxes',
  '04_Family_Health/General',
]

const makeConfig = (overrides = {}) => ({
  modelEndpoint:
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
  geminiApiKey: 'TEST_KEY',
  processedLabel: 'Processed',
  autoFilterConfidenceThreshold: 0.95,
  canonicalDomains: TEST_DOMAINS,
  ...overrides,
})

const makeLabel = (name) => ({
  getName: () => name,
  getId: () => 'label-' + name,
})

const makeGmailApp = ({ existingLabel = null, createFails = false } = {}) => ({
  getUserLabelByName: jest.fn(() => existingLabel),
  createLabel: createFails
    ? jest.fn(() => {
        throw new Error('Label creation failed')
      })
    : jest.fn((name) => makeLabel(name)),
})

const makeThread = ({
  id = 't1',
  sender = 'user@example.com',
  subject = 'Test',
  body = 'body text',
} = {}) => ({
  getId: () => id,
  getMessages: () => [
    {
      getFrom: () => sender,
      getSubject: () => subject,
      getPlainBody: () => body,
    },
  ],
  addLabel: jest.fn(),
})

const makeGeminiResponse = (classification) => ({
  getContentText: () =>
    JSON.stringify({
      candidates: [
        { content: { parts: [{ text: JSON.stringify(classification) }] } },
      ],
    }),
})

// ---------------------------------------------------------------------------
// validateClassification
// ---------------------------------------------------------------------------
describe('validateClassification', () => {
  test('returns true for a valid classification matching a canonical domain', () => {
    expect(
      validateClassification(
        {
          canonical_label: '01_Household/Primary_House',
          confidence: 0.97,
          reasoning: 'ok',
        },
        TEST_DOMAINS
      )
    ).toBe(true)
  })

  test('returns false when canonical_label is missing', () => {
    expect(validateClassification({ confidence: 0.9 }, TEST_DOMAINS)).toBe(
      false
    )
  })

  test('returns false when confidence is above 1', () => {
    expect(
      validateClassification(
        { canonical_label: '01_Household/Primary_House', confidence: 1.5 },
        TEST_DOMAINS
      )
    ).toBe(false)
  })

  test('returns false when confidence is below 0', () => {
    expect(
      validateClassification(
        { canonical_label: '01_Household/Primary_House', confidence: -0.1 },
        TEST_DOMAINS
      )
    ).toBe(false)
  })

  test('returns false for null input', () => {
    expect(validateClassification(null, TEST_DOMAINS)).toBe(false)
  })

  test('returns false when label is not in canonical domains', () => {
    expect(
      validateClassification(
        { canonical_label: 'Unknown/Domain', confidence: 0.9, reasoning: 'ok' },
        TEST_DOMAINS
      )
    ).toBe(false)
  })

  test('skips domain check when canonicalDomains is omitted', () => {
    expect(
      validateClassification({
        canonical_label: 'Anything',
        confidence: 0.8,
        reasoning: 'ok',
      })
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ensureGmailLabel
// ---------------------------------------------------------------------------
describe('ensureGmailLabel', () => {
  test('returns existing label without creating a new one', () => {
    const existing = makeLabel('Processed')
    const gmailApp = makeGmailApp({ existingLabel: existing })
    expect(ensureGmailLabel('Processed', gmailApp)).toBe(existing)
    expect(gmailApp.createLabel).not.toHaveBeenCalled()
  })

  test('creates and returns label when it does not exist', () => {
    const gmailApp = makeGmailApp()
    const label = ensureGmailLabel('NewLabel', gmailApp)
    expect(gmailApp.createLabel).toHaveBeenCalledWith('NewLabel')
    expect(label.getName()).toBe('NewLabel')
  })

  test('returns null when label creation throws', () => {
    const gmailApp = makeGmailApp({ createFails: true })
    expect(ensureGmailLabel('FailLabel', gmailApp)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// createPermanentGmailFilter
// ---------------------------------------------------------------------------
describe('createPermanentGmailFilter', () => {
  const makeGmailService = (
    createFn = jest.fn(),
    listFn = jest.fn(() => ({ filter: [] }))
  ) => ({
    Users: { Settings: { Filters: { create: createFn, list: listFn } } },
  })

  test('creates filter via Gmail service and returns true', () => {
    const gmailApp = makeGmailApp({
      existingLabel: makeLabel('01_Household/Primary_House'),
    })
    const mockCreate = jest.fn()
    const result = createPermanentGmailFilter(
      'sender@example.com',
      '01_Household/Primary_House',
      makeGmailService(mockCreate),
      gmailApp
    )
    expect(result).toBe(true)
    expect(mockCreate).toHaveBeenCalledWith(
      {
        criteria: { from: 'sender@example.com' },
        action: { addLabelIds: ['label-01_Household/Primary_House'] },
      },
      'me'
    )
  })

  test('extracts bare email address from "Display Name <email>" format', () => {
    const gmailApp = makeGmailApp({
      existingLabel: makeLabel('01_Household/Primary_House'),
    })
    const mockCreate = jest.fn()
    createPermanentGmailFilter(
      'John Doe <john@example.com>',
      '01_Household/Primary_House',
      makeGmailService(mockCreate),
      gmailApp
    )
    expect(mockCreate.mock.calls[0][0].criteria.from).toBe('john@example.com')
  })

  test('returns false when Gmail advanced service is null', () => {
    const gmailApp = makeGmailApp({
      existingLabel: makeLabel('01_Household/Primary_House'),
    })
    expect(
      createPermanentGmailFilter(
        'sender@example.com',
        '01_Household/Primary_House',
        null,
        gmailApp
      )
    ).toBe(false)
  })

  test('returns false when target label cannot be created', () => {
    const gmailApp = makeGmailApp({ createFails: true })
    expect(
      createPermanentGmailFilter(
        'sender@example.com',
        '01_Household/Primary_House',
        makeGmailService(),
        gmailApp
      )
    ).toBe(false)
  })

  test('returns false when Gmail service create throws', () => {
    const gmailApp = makeGmailApp({
      existingLabel: makeLabel('01_Household/Primary_House'),
    })
    const throwingService = makeGmailService(
      jest.fn(() => {
        throw new Error('API error')
      })
    )
    expect(
      createPermanentGmailFilter(
        'sender@example.com',
        '01_Household/Primary_House',
        throwingService,
        gmailApp
      )
    ).toBe(false)
  })

  test('returns true without creating a duplicate filter for the same sender', () => {
    const gmailApp = makeGmailApp({
      existingLabel: makeLabel('01_Household/Primary_House'),
    })
    const mockCreate = jest.fn()
    const mockList = jest.fn(() => ({
      filter: [{ criteria: { from: 'sender@example.com' } }],
    }))
    const result = createPermanentGmailFilter(
      'sender@example.com',
      '01_Household/Primary_House',
      makeGmailService(mockCreate, mockList),
      gmailApp
    )
    expect(result).toBe(true)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  test('extracts bare address before duplicate check with display-name format', () => {
    const gmailApp = makeGmailApp({
      existingLabel: makeLabel('01_Household/Primary_House'),
    })
    const mockCreate = jest.fn()
    const mockList = jest.fn(() => ({
      filter: [{ criteria: { from: 'john@example.com' } }],
    }))
    const result = createPermanentGmailFilter(
      'John Doe <john@example.com>',
      '01_Household/Primary_House',
      makeGmailService(mockCreate, mockList),
      gmailApp
    )
    expect(result).toBe(true)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  test('creates filter when no existing filter matches the sender', () => {
    const gmailApp = makeGmailApp({
      existingLabel: makeLabel('01_Household/Primary_House'),
    })
    const mockCreate = jest.fn()
    const mockList = jest.fn(() => ({
      filter: [{ criteria: { from: 'other@example.com' } }],
    }))
    const result = createPermanentGmailFilter(
      'sender@example.com',
      '01_Household/Primary_House',
      makeGmailService(mockCreate, mockList),
      gmailApp
    )
    expect(result).toBe(true)
    expect(mockCreate).toHaveBeenCalled()
  })

  test('still creates filter when list call throws', () => {
    const gmailApp = makeGmailApp({
      existingLabel: makeLabel('01_Household/Primary_House'),
    })
    const mockCreate = jest.fn()
    const throwingList = jest.fn(() => {
      throw new Error('List failed')
    })
    const result = createPermanentGmailFilter(
      'sender@example.com',
      '01_Household/Primary_House',
      makeGmailService(mockCreate, throwingList),
      gmailApp
    )
    expect(result).toBe(true)
    expect(mockCreate).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// classifyEmailWithGemini
// ---------------------------------------------------------------------------
describe('classifyEmailWithGemini', () => {
  const config = makeConfig()

  test('returns validated classification on successful API response', () => {
    const classification = {
      canonical_label: '01_Household/Primary_House',
      confidence: 0.97,
      reasoning: 'test',
    }
    const urlFetchApp = {
      fetch: jest.fn(() => makeGeminiResponse(classification)),
    }
    expect(
      classifyEmailWithGemini(
        config,
        'test@example.com',
        'Subject',
        'body',
        urlFetchApp
      )
    ).toEqual(classification)
  })

  test('returns null when API call throws a network error', () => {
    const urlFetchApp = {
      fetch: jest.fn(() => {
        throw new Error('Network error')
      }),
    }
    expect(
      classifyEmailWithGemini(
        config,
        'test@example.com',
        'Subject',
        'body',
        urlFetchApp
      )
    ).toBeNull()
  })

  test('returns null when API response contains invalid JSON', () => {
    const urlFetchApp = {
      fetch: jest.fn(() => ({ getContentText: () => 'not-json' })),
    }
    expect(
      classifyEmailWithGemini(
        config,
        'test@example.com',
        'Subject',
        'body',
        urlFetchApp
      )
    ).toBeNull()
  })

  test('returns null when classification label is not in canonical domains', () => {
    const classification = {
      canonical_label: 'Unknown/Domain',
      confidence: 0.97,
      reasoning: 'test',
    }
    const urlFetchApp = {
      fetch: jest.fn(() => makeGeminiResponse(classification)),
    }
    expect(
      classifyEmailWithGemini(
        config,
        'test@example.com',
        'Subject',
        'body',
        urlFetchApp
      )
    ).toBeNull()
  })

  test('returns null when confidence is out of range', () => {
    const classification = {
      canonical_label: '01_Household/Primary_House',
      confidence: 1.5,
      reasoning: 'test',
    }
    const urlFetchApp = {
      fetch: jest.fn(() => makeGeminiResponse(classification)),
    }
    expect(
      classifyEmailWithGemini(
        config,
        'test@example.com',
        'Subject',
        'body',
        urlFetchApp
      )
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// processThreadBatch
// ---------------------------------------------------------------------------
describe('processThreadBatch', () => {
  const config = makeConfig()

  const makeServices = ({
    fetchResponse = null,
    gmailService = null,
    labelExists = true,
  } = {}) => ({
    GmailApp: makeGmailApp({
      existingLabel: labelExists ? makeLabel('Processed') : null,
    }),
    UrlFetchApp: { fetch: jest.fn(() => fetchResponse) },
    Gmail: gmailService,
  })

  test('classifies and applies both category and processed labels on success', () => {
    const thread = makeThread()
    const classification = {
      canonical_label: '01_Household/Primary_House',
      confidence: 0.97,
      reasoning: 'ok',
    }
    const services = makeServices({
      fetchResponse: makeGeminiResponse(classification),
    })
    services.GmailApp.getUserLabelByName = jest.fn((name) => makeLabel(name))

    const results = processThreadBatch([thread], config, services)

    expect(results[0].status).toBe('classified')
    expect(results[0].label).toBe('01_Household/Primary_House')
    expect(thread.addLabel).toHaveBeenCalledTimes(2)
  })

  test('creates Gmail filter when confidence meets threshold', () => {
    const thread = makeThread()
    const classification = {
      canonical_label: '01_Household/Primary_House',
      confidence: 0.98,
      reasoning: 'ok',
    }
    const mockCreate = jest.fn()
    const services = {
      GmailApp: makeGmailApp({
        existingLabel: makeLabel('01_Household/Primary_House'),
      }),
      UrlFetchApp: { fetch: jest.fn(() => makeGeminiResponse(classification)) },
      Gmail: { Users: { Settings: { Filters: { create: mockCreate } } } },
    }
    services.GmailApp.getUserLabelByName = jest.fn((name) => makeLabel(name))

    const results = processThreadBatch([thread], config, services)

    expect(results[0].filterCreated).toBe(true)
    expect(mockCreate).toHaveBeenCalled()
  })

  test('skips filter creation when confidence is below threshold', () => {
    const thread = makeThread()
    const classification = {
      canonical_label: '01_Household/Primary_House',
      confidence: 0.9,
      reasoning: 'ok',
    }
    const mockCreate = jest.fn()
    const services = {
      GmailApp: makeGmailApp({ existingLabel: makeLabel('Processed') }),
      UrlFetchApp: { fetch: jest.fn(() => makeGeminiResponse(classification)) },
      Gmail: { Users: { Settings: { Filters: { create: mockCreate } } } },
    }
    services.GmailApp.getUserLabelByName = jest.fn((name) => makeLabel(name))

    const results = processThreadBatch([thread], config, services)

    expect(results[0].filterCreated).toBe(false)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  test('returns unclassified status when Gemini call fails', () => {
    const thread = makeThread()
    const services = {
      GmailApp: makeGmailApp({ existingLabel: makeLabel('Processed') }),
      UrlFetchApp: {
        fetch: jest.fn(() => {
          throw new Error('fail')
        }),
      },
      Gmail: null,
    }

    const results = processThreadBatch([thread], config, services)

    expect(results[0].status).toBe('unclassified')
    expect(thread.addLabel).not.toHaveBeenCalled()
  })

  test('returns empty status for thread with no messages', () => {
    const emptyThread = {
      getId: () => 'empty',
      getMessages: () => [],
      addLabel: jest.fn(),
    }
    const services = makeServices()

    const results = processThreadBatch([emptyThread], config, services)

    expect(results[0].status).toBe('empty')
  })

  test('returns label_creation_failed and skips processed label when category label creation fails', () => {
    const thread = makeThread()
    const classification = {
      canonical_label: '01_Household/Primary_House',
      confidence: 0.97,
      reasoning: 'ok',
    }
    const processedLabelObj = makeLabel('Processed')
    const gmailApp = {
      getUserLabelByName: jest.fn((name) =>
        name === 'Processed' ? processedLabelObj : null
      ),
      createLabel: jest.fn(() => {
        throw new Error('Label creation failed')
      }),
    }
    const services = {
      GmailApp: gmailApp,
      UrlFetchApp: { fetch: jest.fn(() => makeGeminiResponse(classification)) },
      Gmail: null,
    }

    const results = processThreadBatch([thread], config, services)

    expect(results[0].status).toBe('label_creation_failed')
    expect(thread.addLabel).not.toHaveBeenCalled()
  })

  test('processes multiple threads independently', () => {
    const thread1 = makeThread({ id: 't1', sender: 'a@example.com' })
    const thread2 = makeThread({ id: 't2', sender: 'b@example.com' })
    const classification = {
      canonical_label: '01_Household/Primary_House',
      confidence: 0.97,
      reasoning: 'ok',
    }
    const services = {
      GmailApp: {
        getUserLabelByName: jest.fn((name) => makeLabel(name)),
        createLabel: jest.fn((name) => makeLabel(name)),
      },
      UrlFetchApp: { fetch: jest.fn(() => makeGeminiResponse(classification)) },
      Gmail: null,
    }

    const results = processThreadBatch([thread1, thread2], config, services)

    expect(results).toHaveLength(2)
    expect(results[0].threadId).toBe('t1')
    expect(results[1].threadId).toBe('t2')
  })
})
