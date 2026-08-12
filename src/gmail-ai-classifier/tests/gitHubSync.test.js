const {
  appendMarkdownEntryToGitHubRepo,
  executeGitHubCommit,
  extractTopicTitleFromPath,
  insertEntryIntoLogSection,
  fetchRulesFromGitHub,
  commitRulesToGitHub,
  syncTwoWayRules,
} = require('../gitHubSync.gs')

describe('gitHubSync Module', () => {
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
      sleep: jest.fn(),
    }
  })

  describe('extractTopicTitleFromPath', () => {
    test('extracts title from multi-level path', () => {
      expect(extractTopicTitleFromPath('01_Household/my-topic/index.md')).toBe(
        'My Topic'
      )
    })
    test('extracts title from single-level path', () => {
      expect(extractTopicTitleFromPath('my-topic.md')).toBe('My Topic.Md')
    })
  })

  describe('insertEntryIntoLogSection', () => {
    test('inserts before detailsMarker if present', () => {
      const content =
        '# Header\n<details open><summary>Log</summary>\n</details>'
      const result = insertEntryIntoLogSection(content, '- New Log Entry')
      expect(result).toContain('- New Log Entry\n</details>')
    })

    test('inserts after section3Marker if detailsMarker not present', () => {
      const content = '# Header\n## 3. Ingested Activity\nExisting logs'
      const result = insertEntryIntoLogSection(content, '- New Log Entry')
      expect(result).toContain('## 3. Ingested Activity\n- New Log Entry\n')
    })

    test('appends to end if markers not present', () => {
      const content = '# Header\nSome body text'
      const result = insertEntryIntoLogSection(content, '- New Log Entry')
      expect(result).toBe('# Header\nSome body text\n- New Log Entry')
    })
  })

  describe('executeGitHubCommit', () => {
    test('handles 404 by auto-creating new note', () => {
      global.UrlFetchApp = {
        fetch: jest
          .fn()
          .mockImplementationOnce(() => ({
            getResponseCode: () => 404,
            getContentText: () => 'Not Found',
          }))
          .mockImplementationOnce(() => ({
            getResponseCode: () => 201,
            getContentText: () => JSON.stringify({ content: {} }),
          })),
      }

      const res = executeGitHubCommit(
        '01_Household/test/index.md',
        '- entry',
        'commit msg',
        'pat-123'
      )
      expect(res).toBe(true)
    })

    test('handles 200 with idempotent skip', () => {
      const existingContent = '- entry'
      const base64 = Buffer.from(existingContent).toString('base64')
      global.UrlFetchApp = {
        fetch: jest.fn(() => ({
          getResponseCode: () => 200,
          getContentText: () =>
            JSON.stringify({ content: base64, sha: 'sha-1' }),
        })),
      }

      const res = executeGitHubCommit(
        '01_Household/test/index.md',
        '- entry',
        'commit msg',
        'pat-123'
      )
      expect(res).toBe('IDEMPOTENT_SKIP')
    })

    test('handles 500 error fetching file', () => {
      global.UrlFetchApp = {
        fetch: jest.fn(() => ({
          getResponseCode: () => 500,
          getContentText: () => 'Internal Error',
        })),
      }

      const res = executeGitHubCommit(
        '01_Household/test/index.md',
        '- entry',
        'commit msg',
        'pat-123'
      )
      expect(res).toBe(false)
    })

    test('handles 409 SHA collision on PUT', () => {
      const base64 = Buffer.from('- old entry').toString('base64')
      global.UrlFetchApp = {
        fetch: jest
          .fn()
          .mockImplementationOnce(() => ({
            getResponseCode: () => 200,
            getContentText: () =>
              JSON.stringify({ content: base64, sha: 'sha-1' }),
          }))
          .mockImplementationOnce(() => ({
            getResponseCode: () => 409,
            getContentText: () => 'Conflict',
          })),
      }

      const res = executeGitHubCommit(
        '01_Household/test/index.md',
        '- new entry',
        'commit msg',
        'pat-123'
      )
      expect(res).toBe(false)
    })

    test('handles 500 error committing file PUT', () => {
      const base64 = Buffer.from('- old entry').toString('base64')
      global.UrlFetchApp = {
        fetch: jest
          .fn()
          .mockImplementationOnce(() => ({
            getResponseCode: () => 200,
            getContentText: () =>
              JSON.stringify({ content: base64, sha: 'sha-1' }),
          }))
          .mockImplementationOnce(() => ({
            getResponseCode: () => 500,
            getContentText: () => 'Error PUT',
          })),
      }

      const res = executeGitHubCommit(
        '01_Household/test/index.md',
        '- new entry',
        'commit msg',
        'pat-123'
      )
      expect(res).toBe(false)
    })

    test('handles exception during fetch', () => {
      global.UrlFetchApp = {
        fetch: jest.fn(() => {
          throw new Error('Network error')
        }),
      }

      const res = executeGitHubCommit(
        '01_Household/test/index.md',
        '- new entry',
        'commit msg',
        'pat-123'
      )
      expect(res).toBe(false)
    })
  })

  describe('appendMarkdownEntryToGitHubRepo', () => {
    test('returns false when GITHUB_PAT is missing', () => {
      global.PropertiesService = {
        getScriptProperties: () => ({ getProperty: () => null }),
      }
      expect(appendMarkdownEntryToGitHubRepo('path.md', '- entry')).toBe(false)
    })

    test('retries on temporary failure and succeeds', () => {
      const base64 = Buffer.from('- old entry').toString('base64')
      global.UrlFetchApp = {
        fetch: jest
          .fn()
          .mockImplementationOnce(() => ({
            getResponseCode: () => 500,
            getContentText: () => 'Err',
          }))
          .mockImplementationOnce(() => ({
            getResponseCode: () => 200,
            getContentText: () =>
              JSON.stringify({ content: base64, sha: 'sha-1' }),
          }))
          .mockImplementationOnce(() => ({
            getResponseCode: () => 200,
            getContentText: () => '{}',
          })),
      }

      const result = appendMarkdownEntryToGitHubRepo('path.md', '- entry')
      expect(result).toBe(true)
    })

    test('fails after maximum retries', () => {
      global.UrlFetchApp = {
        fetch: jest.fn(() => ({
          getResponseCode: () => 500,
          getContentText: () => 'Err',
        })),
      }
      expect(appendMarkdownEntryToGitHubRepo('path.md', '- entry')).toBe(false)
    })
  })

  describe('2-Way Rules Sync Engine', () => {
    test('fetchRulesFromGitHub returns parsed rules object with SHA', () => {
      const mockRules = {
        version: '1.0.0',
        updatedAt: '2026-08-08T14:00:00Z',
        canonicalDomains: [],
      }
      const mockBase64 = Buffer.from(JSON.stringify(mockRules)).toString(
        'base64'
      )

      global.UrlFetchApp = {
        fetch: jest.fn(() => ({
          getResponseCode: () => 200,
          getContentText: () =>
            JSON.stringify({ content: mockBase64, sha: 'mock-sha-abc' }),
        })),
      }

      const res = fetchRulesFromGitHub('rules.json', 'mock-token')
      expect(res._sha).toBe('mock-sha-abc')
    })

    test('fetchRulesFromGitHub returns null when GITHUB_PAT missing', () => {
      global.PropertiesService = {
        getScriptProperties: () => ({ getProperty: () => null }),
      }
      expect(fetchRulesFromGitHub()).toBeNull()
    })

    test('fetchRulesFromGitHub returns null on HTTP error or exception', () => {
      global.UrlFetchApp = {
        fetch: jest.fn(() => ({
          getResponseCode: () => 500,
          getContentText: () => 'Err',
        })),
      }
      expect(fetchRulesFromGitHub('rules.json', 'mock-token')).toBeNull()

      global.UrlFetchApp = {
        fetch: jest.fn(() => {
          throw new Error('API Exception')
        }),
      }
      expect(fetchRulesFromGitHub('rules.json', 'mock-token')).toBeNull()
    })

    test('commitRulesToGitHub handles missing token', () => {
      global.PropertiesService = {
        getScriptProperties: () => ({ getProperty: () => null }),
      }
      expect(commitRulesToGitHub({}, 'msg')).toBe(false)
    })

    test('commitRulesToGitHub handles API exception', () => {
      global.UrlFetchApp = {
        fetch: jest.fn(() => {
          throw new Error('API Error')
        }),
      }
      expect(commitRulesToGitHub({}, 'msg', 'token')).toBe(false)
    })

    test('syncTwoWayRules initializes local ScriptProperty when empty', () => {
      const remoteRules = {
        version: '1.0.0',
        updatedAt: '2026-08-08T10:00:00Z',
      }
      const mockBase64 = Buffer.from(JSON.stringify(remoteRules)).toString(
        'base64'
      )

      global.UrlFetchApp = {
        fetch: jest.fn(() => ({
          getResponseCode: () => 200,
          getContentText: () =>
            JSON.stringify({ content: mockBase64, sha: 'sha-1' }),
        })),
      }

      const setPropertySpy = jest.fn()
      global.PropertiesService = {
        getScriptProperties: () => ({
          getProperty: (key) => {
            if (key === 'GITHUB_PAT') return 'mock-pat'
            return null
          },
          setProperty: setPropertySpy,
        }),
      }

      expect(syncTwoWayRules()).toBe(true)
      expect(setPropertySpy).toHaveBeenCalledWith(
        'CLASSIFICATION_RULES_JSON',
        expect.stringContaining('1.0.0')
      )
    })

    test('syncTwoWayRules handles local rule push when local is newer', () => {
      const remoteRules = {
        version: '1.0.0',
        updatedAt: '2026-08-08T10:00:00Z',
      }
      const mockBase64 = Buffer.from(JSON.stringify(remoteRules)).toString(
        'base64'
      )

      const fetchSpy = jest
        .fn()
        .mockImplementationOnce(() => ({
          getResponseCode: () => 200,
          getContentText: () =>
            JSON.stringify({ content: mockBase64, sha: 'sha-old' }),
        }))
        .mockImplementationOnce(() => ({
          getResponseCode: () => 200,
          getContentText: () =>
            JSON.stringify({ content: mockBase64, sha: 'sha-old' }),
        }))
        .mockImplementationOnce(() => ({
          getResponseCode: () => 200,
          getContentText: () => '{}',
        }))

      global.UrlFetchApp = { fetch: fetchSpy }
      global.PropertiesService = {
        getScriptProperties: () => ({
          getProperty: (key) => {
            if (key === 'GITHUB_PAT') return 'mock-pat'
            if (key === 'CLASSIFICATION_RULES_JSON')
              return JSON.stringify({
                version: '1.1.0',
                updatedAt: '2026-08-08T15:00:00Z',
              })
            return null
          },
          setProperty: jest.fn(),
        }),
      }

      expect(syncTwoWayRules()).toBe(true)
    })

    test('syncTwoWayRules logs up-to-date when timestamps match', () => {
      const rules = { version: '1.0.0', updatedAt: '2026-08-08T10:00:00Z' }
      const mockBase64 = Buffer.from(JSON.stringify(rules)).toString('base64')

      global.UrlFetchApp = {
        fetch: jest.fn(() => ({
          getResponseCode: () => 200,
          getContentText: () =>
            JSON.stringify({ content: mockBase64, sha: 'sha-1' }),
        })),
      }

      global.PropertiesService = {
        getScriptProperties: () => ({
          getProperty: (key) => {
            if (key === 'GITHUB_PAT') return 'mock-pat'
            if (key === 'CLASSIFICATION_RULES_JSON')
              return JSON.stringify(rules)
            return null
          },
          setProperty: jest.fn(),
        }),
      }

      expect(syncTwoWayRules()).toBe(true)
    })

    test('syncTwoWayRules returns false when remoteRules is null', () => {
      global.UrlFetchApp = {
        fetch: jest.fn(() => ({
          getResponseCode: () => 404,
          getContentText: () => 'Not Found',
        })),
      }

      global.PropertiesService = {
        getScriptProperties: () => ({
          getProperty: () => 'mock-pat',
        }),
      }

      expect(syncTwoWayRules()).toBe(false)
    })
  })
})
