const {
  ensureDriveTaxonomyFolder,
  persistCanonicalAttachmentsToDrive,
  auditAndBackfillCanonicalAttachments,
  runDryRunAttachmentAudit,
  reclassifyThreadsByQuery,
  runRealignmentAudit,
} = require('../src/index.js')

const makeFolder = (name) => {
  const subfolders = new Map()
  const files = new Map()
  return {
    name,
    _files: files,
    getFoldersByName: (n) => {
      const found = subfolders.get(n)
      let done = false
      return {
        hasNext: () => !done && !!found,
        next: () => {
          done = true
          return found
        },
      }
    },
    createFolder: (n) => {
      const f = makeFolder(n)
      subfolders.set(n, f)
      return f
    },
    getFilesByName: (n) => {
      const list = files.get(n) || []
      let i = 0
      return { hasNext: () => i < list.length, next: () => list[i++] }
    },
    createFile: jest.fn((blob) => {
      let desc = ''
      const file = {
        getName: () => blob.getName(),
        getId: () => 'id-' + blob.getName(),
        getUrl: () => 'https://drive/' + blob.getName(),
        getSize: () => blob.getBytes().length,
        getBlob: () => blob,
        setDescription: (d) => {
          desc = d
        },
        getDescription: () => desc,
        moveTo: jest.fn(),
      }
      const list = files.get(blob.getName()) || []
      list.push(file)
      files.set(blob.getName(), list)
      return file
    }),
  }
}

const makeDrive = () => {
  const root = makeFolder('root')
  return { root, getRootFolder: () => root }
}

const makeAtt = (name = 'statement.pdf', content = 'pdf content here') => {
  const bytes = Buffer.from(content)
  return {
    getName: () => name,
    getContentType: () => 'application/pdf',
    getBytes: () => bytes,
    getSize: () => bytes.length,
    copyBlob() {
      return this
    },
  }
}

const makeThread = ({
  labels = [],
  atts = [],
  body = 'long enough body text',
}) => ({
  getId: () => 'th1',
  getFirstMessageSubject: () => 'Subj',
  getLabels: () => labels.map((n) => ({ getName: () => n })),
  getMessages: () => [
    {
      getFrom: () => 'a@b.com',
      getSubject: () => 'Subj',
      getPlainBody: () => body,
      getAttachments: () => atts,
    },
  ],
  addLabel: jest.fn(),
  removeLabel: jest.fn(),
})

const config = {
  canonicalDomains: ['01_Household', '02_Finance_Legal'],
  processedLabel: 'Processed',
}

let logSpy, warnSpy, errSpy
beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  jest.restoreAllMocks()
  delete global.DriveApp
  delete global.GmailApp
})

describe('global DriveApp fallbacks', () => {
  test('ensureDriveTaxonomyFolder uses global DriveApp when none injected', () => {
    global.DriveApp = makeDrive()
    const folder = ensureDriveTaxonomyFolder('01_Household', 'Primary_House')
    expect(folder.name).toBe('Primary_House')
  })

  test('ensureDriveTaxonomyFolder throws without any DriveApp', () => {
    expect(() => ensureDriveTaxonomyFolder('01_Household', 'x')).toThrow(
      'DriveApp service unavailable'
    )
  })

  test('persistCanonicalAttachmentsToDrive uses global DriveApp', () => {
    global.DriveApp = makeDrive()
    const thread = makeThread({ atts: [makeAtt()] })
    const saved = persistCanonicalAttachmentsToDrive(
      thread,
      { canonicalDomain: '02_Finance_Legal' },
      config,
      undefined
    )
    expect(saved).toHaveLength(1)
    expect(saved[0].domain).toBe('02_Finance_Legal')
  })

  test('persistCanonicalAttachmentsToDrive returns [] when no DriveApp', () => {
    const saved = persistCanonicalAttachmentsToDrive(
      makeThread({}),
      { canonicalDomain: '02_Finance_Legal' },
      config,
      undefined
    )
    expect(saved).toEqual([])
    expect(errSpy).toHaveBeenCalled()
  })
})

describe('auditAndBackfillCanonicalAttachments edge cases', () => {
  test('throws when GmailApp/DriveApp are unavailable', () => {
    expect(() => auditAndBackfillCanonicalAttachments({}, config, {})).toThrow(
      'GmailApp and DriveApp services are required'
    )
  })

  test('records BACKFILL_ERROR when createFile throws', () => {
    const drive = makeDrive()
    const thread = makeThread({
      labels: ['02_Finance_Legal', 'Finance/Banking'],
      atts: [makeAtt()],
    })
    const gmail = { search: () => [thread] }
    // Pre-create the target folder so we can make createFile fail
    const folder = ensureDriveTaxonomyFolder(
      '02_Finance_Legal',
      'Banking',
      drive
    )
    folder.createFile.mockImplementation(() => {
      throw new Error('disk full')
    })
    const report = auditAndBackfillCanonicalAttachments(
      { dryRun: false },
      config,
      { GmailApp: gmail, DriveApp: drive }
    )
    expect(report.backfilledCount).toBe(0)
    expect(report.items[0]).toMatchObject({
      status: 'BACKFILL_ERROR',
      error: 'disk full',
    })
  })
})

describe('auditAndBackfillCanonicalAttachments budget, folder and size paths', () => {
  const labels = ['02_Finance_Legal', 'Finance/Banking']

  test('stops when the time budget is exhausted', () => {
    const report = auditAndBackfillCanonicalAttachments(
      { timeBudgetMs: -1 },
      config,
      {
        GmailApp: { search: () => [makeThread({ labels })] },
        DriveApp: makeDrive(),
      }
    )
    expect(report.timeBudgetReached).toBe(true)
    expect(report.totalAttachmentsInspected).toBe(0)
  })

  test('skips threads whose taxonomy folder cannot be resolved', () => {
    const report = auditAndBackfillCanonicalAttachments({}, config, {
      GmailApp: { search: () => [makeThread({ labels, atts: [makeAtt()] })] },
      DriveApp: {
        getRootFolder: () => {
          throw new Error('no drive')
        },
      },
    })
    expect(report.totalAttachmentsInspected).toBe(0)
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('no drive'))
  })

  test('derives size from bytes when attachment has no getSize', () => {
    const att = makeAtt('sheet.pdf', 'x'.repeat(2048))
    delete att.getSize
    const report = auditAndBackfillCanonicalAttachments({}, config, {
      GmailApp: { search: () => [makeThread({ labels, atts: [att] })] },
      DriveApp: makeDrive(),
    })
    expect(report.items[0]).toMatchObject({
      status: 'MISSING_FROM_DRIVE',
      fileSizeKb: 2,
    })
    expect(report.totalEligibleAttachments).toBe(1)
  })
})

describe('runDryRunAttachmentAudit manifest output', () => {
  test('prints type, reason and item lines', () => {
    const drive = makeDrive()
    const thread = makeThread({
      labels: ['02_Finance_Legal', 'Finance/Banking'],
      atts: [makeAtt(), makeAtt('junk.ics', 'x')],
    })
    const report = runDryRunAttachmentAudit({}, config, {
      GmailApp: { search: () => [thread] },
      DriveApp: drive,
    })
    expect(report.items).toHaveLength(1)
    const lines = logSpy.mock.calls.map((c) => c[0])
    expect(lines).toContain('  .pdf: 1')
    expect(lines).toContain('  BLOCKED_EXTENSION: 1')
    expect(
      lines.some((l) => /^\s+\[1\] \[02_Finance_Legal\/Banking\]/.test(l))
    ).toBe(true)
  })
})

describe('reclassifyThreadsByQuery', () => {
  const makeGmail = (threads) => ({
    search: jest.fn(() => threads),
    getUserLabelByName: jest.fn((n) => ({ getName: () => n })),
    createLabel: jest.fn((n) => ({ getName: () => n })),
  })

  test('throws without GmailApp', () => {
    expect(() => reclassifyThreadsByQuery('q', {}, config, {})).toThrow(
      'GmailApp service is required'
    )
  })

  test('stops when the time budget is exhausted', () => {
    const gmail = makeGmail([makeThread({})])
    const classifyFn = jest.fn()
    const res = reclassifyThreadsByQuery('q', { timeBudgetMs: -1 }, config, {
      GmailApp: gmail,
      classifyFn,
    })
    expect(classifyFn).not.toHaveBeenCalled()
    expect(res.reclassified).toBe(0)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('safety ceiling')
    )
  })

  test('adds attachment names to short snippets and survives classifier errors', () => {
    const short = makeThread({ body: 'hi', atts: [makeAtt('a.pdf')] })
    const throwing = makeThread({ body: 'hi' })
    const classifyFn = jest
      .fn()
      .mockImplementationOnce((s, subj, snippet) => {
        expect(snippet).toBe('hi [Attached: a.pdf]')
        return {
          canonicalDomain: '01_Household',
          subLabel: 'Household/General',
        }
      })
      .mockImplementationOnce(() => {
        throw new Error('model down')
      })
    const res = reclassifyThreadsByQuery('q', { dryRun: true }, config, {
      GmailApp: makeGmail([short, throwing]),
      classifyFn,
    })
    expect(res.reclassified).toBe(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('model down'))
  })

  test('ignores attachment lookup errors for short bodies', () => {
    const thread = makeThread({ body: '' })
    const msg = {
      getFrom: () => 'a',
      getSubject: () => 's',
      getPlainBody: () => '',
      getAttachments: () => {
        throw new Error('nope')
      },
    }
    thread.getMessages = () => [msg]
    const classifyFn = jest.fn((s, subj, snippet) => {
      expect(snippet).toBe('')
      return null
    })
    const res = reclassifyThreadsByQuery('q', {}, config, {
      GmailApp: makeGmail([thread]),
      classifyFn,
    })
    expect(classifyFn).toHaveBeenCalled()
    expect(res.reclassified).toBe(0)
  })

  test('live mode resolves default sub-label from domain, nulls unmapped roots', () => {
    const mapped = makeThread({})
    const unmapped = makeThread({})
    const gmail = makeGmail([mapped, unmapped])
    const classifyFn = jest
      .fn()
      .mockReturnValueOnce({ canonicalDomain: '01_Household' })
      .mockReturnValueOnce({ canonicalDomain: '01_Unmapped' })
    reclassifyThreadsByQuery('q', {}, config, {
      GmailApp: gmail,
      classifyFn,
    })
    expect(gmail.getUserLabelByName).toHaveBeenCalledWith('Household/General')
    expect(gmail.getUserLabelByName).not.toHaveBeenCalledWith('01_Unmapped')
    expect(mapped.addLabel).toHaveBeenCalledTimes(2)
    expect(unmapped.addLabel).toHaveBeenCalledTimes(1)
  })

  test('relocates and persists attachments, and prints dry-run move summary', () => {
    const drive = makeDrive()
    const oldFolder = ensureDriveTaxonomyFolder(
      '01_Household',
      'Primary_House',
      drive
    )
    const existing = oldFolder.createFile(makeAtt('statement.pdf'))
    const thread = makeThread({
      labels: ['01_Household', 'Household/General'],
      atts: [
        makeAtt('statement.pdf'),
        makeAtt('', 'x'),
        makeAtt('b.pdf', 'bb'),
      ],
    })
    // blank-named attachment is ineligible; give b.pdf no existing file
    const classifyFn = jest.fn(() => ({
      canonicalDomain: '02_Finance_Legal',
      subLabel: 'Finance/Banking',
      category: 'Updates',
      action: 'keep',
    }))
    const gmail = makeGmail([thread])
    const services = {
      GmailApp: gmail,
      DriveApp: drive,
      Utilities: { formatDate: () => '2026-01-01T00:00:00Z' },
      classifyFn,
    }
    const live = reclassifyThreadsByQuery('q', {}, config, services)
    expect(existing.moveTo).toHaveBeenCalled()
    expect(live.items[0].attachmentsMoved).toEqual([
      {
        name: 'statement.pdf',
        from: '01_Household/Primary_House',
        to: '02_Finance_Legal/Banking',
      },
    ])
    expect(live.items[0].attachmentsSaved.length).toBeGreaterThan(0)

    const dry = reclassifyThreadsByQuery(
      'q',
      { dryRun: true },
      config,
      services
    )
    expect(dry.dryRun).toBe(true)
    expect(dry.items[0].labelChanged).toBe(true)
  })

  test('reports unchanged labels as not changed in dry-run', () => {
    const res = reclassifyThreadsByQuery('q', { dryRun: true }, config, {
      GmailApp: makeGmail([makeThread({ labels: ['01_Household'] })]),
      classifyFn: () => ({ canonicalDomain: '01_Household' }),
    })
    expect(res.items[0].labelChanged).toBe(false)
    expect(res.items[0].tldChanged).toBe(false)
  })

  test('warns when Drive relocation fails', () => {
    const brokenDrive = {
      getRootFolder: () => {
        throw new Error('drive offline')
      },
    }
    const thread = makeThread({
      labels: ['01_Household', 'Household/General'],
      atts: [makeAtt()],
    })
    reclassifyThreadsByQuery('q', {}, config, {
      GmailApp: makeGmail([thread]),
      DriveApp: brokenDrive,
      Utilities: {},
      classifyFn: () => ({
        canonicalDomain: '02_Finance_Legal',
        subLabel: 'Finance/Banking',
      }),
    })
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('drive offline')
    )
  })
})

describe('runRealignmentAudit', () => {
  test('discovers sister labels and builds the query', () => {
    const gmail = {
      getUserLabels: () => [
        { getName: () => 'Family/Sisters' },
        { getName: () => 'Other' },
      ],
      search: jest.fn(() => []),
    }
    const res = runRealignmentAudit(undefined, {}, config, { GmailApp: gmail })
    expect(res.query).toBe('label:"Family/Sisters" OR "name change"')
    expect(res.dryRun).toBe(true)
  })

  test('falls back to the default query when label discovery fails', () => {
    const gmail = {
      getUserLabels: () => {
        throw new Error('labels unavailable')
      },
      search: jest.fn(() => []),
    }
    const res = runRealignmentAudit('', {}, config, { GmailApp: gmail })
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('labels unavailable')
    )
    expect(res.query).toBe('label:"Family/Sisters" OR "name change"')
  })
})
