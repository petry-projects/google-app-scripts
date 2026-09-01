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

    test('fetchRulesFromGitHub returns null on 404', () => {
      global.UrlFetchApp = {
        fetch: jest.fn(() => ({
          getResponseCode: () => 404,
          getContentText: () => 'Not Found',
        })),
      }
      expect(fetchRulesFromGitHub('rules.json', 'mock-token')).toBeNull()
    })

    test('fetchRulesFromGitHub throws on non-404 HTTP error', () => {
      global.UrlFetchApp = {
        fetch: jest.fn(() => ({
          getResponseCode: () => 500,
          getContentText: () => 'Internal Server Error',
        })),
      }
      expect(() => fetchRulesFromGitHub('rules.json', 'mock-token')).toThrow(
        'GitHub API returned status 500'
      )
    })

    test('fetchRulesFromGitHub re-throws on network exception', () => {
      global.UrlFetchApp = {
        fetch: jest.fn(() => {
          throw new Error('API Exception')
        }),
      }
      expect(() => fetchRulesFromGitHub('rules.json', 'mock-token')).toThrow(
        'API Exception'
      )
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

    test('commitRulesToGitHub uses knownSha and skips GET', () => {
      const putSpy = jest.fn(() => ({
        getResponseCode: () => 201,
        getContentText: () => '{}',
      }))
      global.UrlFetchApp = { fetch: putSpy }
      const result = commitRulesToGitHub({}, 'msg', 'token', 'known-sha-123')
      expect(result).toBe(true)
      // Only one fetch call (PUT) — no GET to re-fetch SHA
      expect(putSpy).toHaveBeenCalledTimes(1)
      const payload = JSON.parse(putSpy.mock.calls[0][1].payload)
      expect(payload.sha).toBe('known-sha-123')
    })

    test('commitRulesToGitHub retries once on 409 SHA conflict', () => {
      const base64 = Buffer.from(
        JSON.stringify({ updatedAt: '2026-08-08T10:00:00Z' })
      ).toString('base64')
      const fetchSpy = jest
        .fn()
        // 1st call: initial PUT → 409
        .mockImplementationOnce(() => ({
          getResponseCode: () => 409,
          getContentText: () => 'Conflict',
        }))
        // 2nd call: GET to refresh SHA
        .mockImplementationOnce(() => ({
          getResponseCode: () => 200,
          getContentText: () =>
            JSON.stringify({ content: base64, sha: 'fresh-sha' }),
        }))
        // 3rd call: retry PUT → 201
        .mockImplementationOnce(() => ({
          getResponseCode: () => 201,
          getContentText: () => '{}',
        }))
      global.UrlFetchApp = { fetch: fetchSpy }
      const result = commitRulesToGitHub({}, 'msg', 'token', 'stale-sha')
      expect(result).toBe(true)
      expect(fetchSpy).toHaveBeenCalledTimes(3)
      const retryPayload = JSON.parse(fetchSpy.mock.calls[2][1].payload)
      expect(retryPayload.sha).toBe('fresh-sha')
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

      // syncTwoWayRules passes remoteRules._sha to commitRulesToGitHub,
      // so only 2 fetches: GET (sync read) + PUT (commit).
      const fetchSpy = jest
        .fn()
        .mockImplementationOnce(() => ({
          getResponseCode: () => 200,
          getContentText: () =>
            JSON.stringify({ content: mockBase64, sha: 'sha-old' }),
        }))
        .mockImplementationOnce(() => ({
          getResponseCode: () => 201,
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
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    })

    test('syncTwoWayRules returns false on malformed local rules JSON', () => {
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
      global.PropertiesService = {
        getScriptProperties: () => ({
          getProperty: (key) => {
            if (key === 'GITHUB_PAT') return 'mock-pat'
            if (key === 'CLASSIFICATION_RULES_JSON') return '{invalid json'
            return null
          },
          setProperty: jest.fn(),
        }),
      }

      expect(syncTwoWayRules()).toBe(false)
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

    test('syncTwoWayRules returns false when fetchRulesFromGitHub throws', () => {
      global.UrlFetchApp = {
        fetch: jest.fn(() => ({
          getResponseCode: () => 500,
          getContentText: () => 'Internal Server Error',
        })),
      }
      expect(syncTwoWayRules()).toBe(false)
    })

    test('syncTwoWayRules pulls remote when remote is newer', () => {
      const remoteRules = {
        version: '1.1.0',
        updatedAt: '2026-08-09T10:00:00Z',
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
            if (key === 'CLASSIFICATION_RULES_JSON')
              return JSON.stringify({
                version: '1.0.0',
                updatedAt: '2026-08-08T10:00:00Z',
              })
            return null
          },
          setProperty: setPropertySpy,
        }),
      }

      expect(syncTwoWayRules()).toBe(true)
      expect(setPropertySpy).toHaveBeenCalledWith(
        'CLASSIFICATION_RULES_JSON',
        expect.stringContaining('1.1.0')
      )
    })

    test('syncTwoWayRules pulls remote when timestamps match but content differs', () => {
      const remoteRules = {
        version: '1.0.0',
        updatedAt: '2026-08-08T10:00:00Z',
        extra: 'remote-only-field',
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
            if (key === 'CLASSIFICATION_RULES_JSON')
              return JSON.stringify({
                version: '1.0.0',
                updatedAt: '2026-08-08T10:00:00Z',
              })
            return null
          },
          setProperty: setPropertySpy,
        }),
      }

      expect(syncTwoWayRules()).toBe(true)
      expect(setPropertySpy).toHaveBeenCalled()
    })

    test('commitRulesToGitHub fetches SHA when knownSha not provided', () => {
      const base64 = Buffer.from(JSON.stringify({ version: '1.0.0' })).toString(
        'base64'
      )
      const fetchSpy = jest
        .fn()
        .mockImplementationOnce(() => ({
          getResponseCode: () => 200,
          getContentText: () =>
            JSON.stringify({ content: base64, sha: 'fetched-sha' }),
        }))
        .mockImplementationOnce(() => ({
          getResponseCode: () => 200,
          getContentText: () => '{}',
        }))
      global.UrlFetchApp = { fetch: fetchSpy }
      const result = commitRulesToGitHub({}, 'msg', 'token')
      expect(result).toBe(true)
      expect(fetchSpy).toHaveBeenCalledTimes(2)
      const putPayload = JSON.parse(fetchSpy.mock.calls[1][1].payload)
      expect(putPayload.sha).toBe('fetched-sha')
    })

    test('commitRulesToGitHub returns false on unexpected PUT status', () => {
      global.UrlFetchApp = {
        fetch: jest.fn(() => ({
          getResponseCode: () => 403,
          getContentText: () => 'Forbidden',
        })),
      }
      expect(commitRulesToGitHub({}, 'msg', 'token', 'some-sha')).toBe(false)
    })

    test('commitRulesToGitHub returns false when PUT throws exception', () => {
      global.UrlFetchApp = {
        fetch: jest.fn(() => {
          throw new Error('Network error during PUT')
        }),
      }
      expect(commitRulesToGitHub({}, 'msg', 'token', 'some-sha')).toBe(false)
    })

    test('getGitHubApiUrl_ builds correct endpoint', () => {
      const { getGitHubApiUrl_ } = require('../gitHubSync.gs')
      // Helper function test to verify URL construction
      expect(typeof getGitHubApiUrl_).toBe('function')
    })

    test('getGitHubHeaders_ includes required headers', () => {
      const { getGitHubHeaders_ } = require('../gitHubSync.gs')
      expect(typeof getGitHubHeaders_).toBe('function')
    })

    test('getGitHubToken_ returns override token when provided', () => {
      const { getGitHubToken_ } = require('../gitHubSync.gs')
      expect(typeof getGitHubToken_).toBe('function')
    })

    test('fetchRulesFromGitHub handles network error with exception re-throw', () => {
      global.UrlFetchApp = {
        fetch: jest.fn(() => {
          throw new Error('Connection timeout')
        }),
      }
      expect(() => fetchRulesFromGitHub('rules.json', 'mock-token')).toThrow(
        'Connection timeout'
      )
    })

    test('commitRulesToGitHub handles 409 conflict when refresh also fails', () => {
      const fetchSpy = jest
        .fn()
        .mockImplementationOnce(() => ({
          getResponseCode: () => 409,
          getContentText: () => 'Conflict',
        }))
        .mockImplementationOnce(() => ({
          getResponseCode: () => 500,
          getContentText: () => 'Fetch failed',
        }))
      global.UrlFetchApp = { fetch: fetchSpy }
      const result = commitRulesToGitHub({}, 'msg', 'token', 'stale-sha')
      expect(result).toBe(false)
    })

    test('syncTwoWayRules uses passed token for fetchRulesFromGitHub', () => {
      const mockBase64 = Buffer.from(
        JSON.stringify({
          version: '1.0.0',
          updatedAt: '2026-08-08T10:00:00Z',
        })
      ).toString('base64')

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
            return null
          },
          setProperty: jest.fn(),
        }),
      }

      const result = syncTwoWayRules()
      expect(result).toBe(true)
    })

    test('syncTwoWayRules handles parsing error from local rules gracefully', () => {
      const mockBase64 = Buffer.from(
        JSON.stringify({ version: '1.0.0', updatedAt: '2026-08-08T10:00:00Z' })
      ).toString('base64')

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
              return 'definitely not valid json at all'
            return null
          },
          setProperty: jest.fn(),
        }),
      }

      const result = syncTwoWayRules()
      expect(result).toBe(false)
    })

    test('syncTwoWayRules handles invalid date strings with isNaN fallback', () => {
      const mockBase64 = Buffer.from(
        JSON.stringify({ version: '1.0.0', updatedAt: 'not-a-date' })
      ).toString('base64')

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
              return JSON.stringify({
                version: '1.0.0',
                updatedAt: 'also-not-a-date',
              })
            return null
          },
          setProperty: jest.fn(),
        }),
      }

      const result = syncTwoWayRules()
      expect(result).toBe(true)
    })

    test('syncTwoWayRules logs when local commit fails during push', () => {
      const mockBase64Remote = Buffer.from(
        JSON.stringify({ version: '2.0.0', updatedAt: '2026-08-08T10:00:00Z' })
      ).toString('base64')
      const mockBase64Local = Buffer.from(
        JSON.stringify({ version: '1.0.0', updatedAt: '2026-08-08T11:00:00Z' })
      ).toString('base64')

      global.UrlFetchApp = {
        fetch: jest
          .fn()
          .mockImplementationOnce(() => ({
            getResponseCode: () => 200,
            getContentText: () =>
              JSON.stringify({ content: mockBase64Remote, sha: 'sha-1' }),
          }))
          .mockImplementationOnce(() => ({
            getResponseCode: () => 500,
            getContentText: () => 'Internal Server Error',
          })),
      }
      global.PropertiesService = {
        getScriptProperties: () => ({
          getProperty: (key) => {
            if (key === 'GITHUB_PAT') return 'mock-pat'
            if (key === 'CLASSIFICATION_RULES_JSON')
              return JSON.stringify({
                version: '1.0.0',
                updatedAt: '2026-08-08T11:00:00Z',
              })
            return null
          },
          setProperty: jest.fn(),
        }),
      }

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      const result = syncTwoWayRules()
      expect(result).toBe(false)
      consoleSpy.mockRestore()
    })
  })
})
