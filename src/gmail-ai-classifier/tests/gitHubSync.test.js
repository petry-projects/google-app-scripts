const {
  fetchRulesFromGitHub,
  commitRulesToGitHub,
  syncTwoWayRules,
} = require('../gitHubSync.gs')

describe('2-Way Rules Sync Engine', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.GITHUB_REPO_OWNER = 'user-org'
    global.GITHUB_REPO_NAME = 'self-private'
    global.PropertiesService = {
      getScriptProperties: jest.fn(() => ({
        getProperty: jest.fn((key) => {
          if (key === 'GITHUB_PAT') return 'mock-pat-123'
          if (key === 'CLASSIFICATION_RULES_JSON')
            return JSON.stringify({
              version: '1.0.0',
              updatedAt: '2026-08-08T12:00:00Z',
              rules: [],
            })
          return null
        }),
        setProperty: jest.fn(),
      })),
    }
    global.Utilities = {
      base64Decode: jest.fn((str) =>
        Buffer.from(str, 'base64').toString('binary')
      ),
      base64Encode: jest.fn((str) => Buffer.from(str).toString('base64')),
      newBlob: jest.fn((data) => ({ getDataAsString: () => data })),
      formatDate: jest.fn(() => '2026-08-08T14:00:00Z'),
    }
  })

  test('fetchRulesFromGitHub returns parsed rules object with SHA', () => {
    const mockRules = {
      version: '1.0.0',
      updatedAt: '2026-08-08T14:00:00Z',
      canonicalDomains: [],
    }
    const mockBase64 = Buffer.from(JSON.stringify(mockRules)).toString('base64')

    global.UrlFetchApp = {
      fetch: jest.fn(() => ({
        getResponseCode: () => 200,
        getContentText: () =>
          JSON.stringify({ content: mockBase64, sha: 'mock-sha-abc' }),
      })),
    }

    const res = fetchRulesFromGitHub(
      '05_Tech_Infrastructure/gmail-cleanup-and-label-taxonomy/rules.json',
      'mock-token'
    )
    expect(res).toBeDefined()
    expect(res._sha).toBe('mock-sha-abc')
    expect(res.version).toBe('1.0.0')
  })

  test('syncTwoWayRules updates local ScriptProperties when remote is newer', () => {
    const remoteRules = {
      version: '1.1.0',
      updatedAt: '2026-08-08T15:00:00Z',
      rules: [{ taxonomyLabel: 'New' }],
    }
    const mockBase64 = Buffer.from(JSON.stringify(remoteRules)).toString(
      'base64'
    )

    global.UrlFetchApp = {
      fetch: jest.fn(() => ({
        getResponseCode: () => 200,
        getContentText: () =>
          JSON.stringify({ content: mockBase64, sha: 'sha-new' }),
      })),
    }

    const setPropertySpy = jest.fn()
    global.PropertiesService.getScriptProperties = jest.fn(() => ({
      getProperty: jest.fn((key) => {
        if (key === 'GITHUB_PAT') return 'mock-pat'
        if (key === 'CLASSIFICATION_RULES_JSON')
          return JSON.stringify({
            version: '1.0.0',
            updatedAt: '2026-08-08T10:00:00Z',
          })
        return null
      }),
      setProperty: setPropertySpy,
    }))

    const result = syncTwoWayRules()
    expect(result).toBe(true)
    expect(setPropertySpy).toHaveBeenCalledWith(
      'CLASSIFICATION_RULES_JSON',
      expect.stringContaining('1.1.0')
    )
  })

  test('commitRulesToGitHub pushes payload to GitHub REST API', () => {
    const mockRules = { version: '1.2.0', canonicalDomains: [] }
    const fetchSpy = jest
      .fn()
      .mockImplementationOnce(() => ({
        getResponseCode: () => 200,
        getContentText: () =>
          JSON.stringify({
            content: Buffer.from(JSON.stringify(mockRules)).toString('base64'),
            sha: 'sha-old',
          }),
      }))
      .mockImplementationOnce(() => ({
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ content: {} }),
      }))

    global.UrlFetchApp = { fetch: fetchSpy }

    const success = commitRulesToGitHub(
      mockRules,
      'test commit message',
      'mock-token'
    )
    expect(success).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})
