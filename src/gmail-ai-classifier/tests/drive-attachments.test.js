const {
  isCanonicalClassification,
  resolveTaxonomySubfolderName,
  isEligibleAttachment,
  ensureDriveTaxonomyFolder,
  isDuplicateAttachment,
  resolveAttachmentName,
  persistCanonicalAttachmentsToDrive,
  formatProgressiveDisclosureEntry,
} = require('../src/index.js')

// Helper mock makers
const createMockFolder = (name = 'folder', id = 'f-' + name) => {
  const subfolders = new Map()
  const files = new Map()

  return {
    getName: () => name,
    getId: () => id,
    getFoldersByName: jest.fn((subName) => {
      const found = subfolders.get(subName)
      let yielded = false
      return {
        hasNext: () => !yielded && !!found,
        next: () => {
          yielded = true
          return found
        },
      }
    }),
    createFolder: jest.fn((subName) => {
      const newSub = createMockFolder(subName, id + '/' + subName)
      subfolders.set(subName, newSub)
      return newSub
    }),
    getFilesByName: jest.fn((fileName) => {
      const list = files.get(fileName) || []
      let idx = 0
      return {
        hasNext: () => idx < list.length,
        next: () => list[idx++],
      }
    }),
    createFile: jest.fn((blob) => {
      const fileName = blob.getName ? blob.getName() : blob.name || 'file'
      const fileId =
        'file-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
      const mockFile = {
        getName: () => fileName,
        getId: () => fileId,
        getUrl: () => 'https://drive.google.com/file/d/' + fileId,
        getSize: () =>
          blob.getBytes
            ? blob.getBytes().length
            : blob.bytes
              ? blob.bytes.length
              : 0,
        getBlob: () => blob,
      }
      if (!files.has(fileName)) {
        files.set(fileName, [])
      }
      files.get(fileName).push(mockFile)
      return mockFile
    }),
    _subfolders: subfolders,
    _files: files,
  }
}

const createMockDriveApp = () => {
  const rootFolder = createMockFolder('root', 'root')
  return {
    getRootFolder: () => rootFolder,
  }
}

const createMockAttachment = ({
  name = 'statement.pdf',
  contentType = 'application/pdf',
  content = 'Sample PDF document content for testing',
  size = null,
} = {}) => {
  const bytes = Buffer.from(content, 'utf-8')
  let currentName = name

  return {
    getName: () => currentName,
    setName: (n) => {
      currentName = n
    },
    getContentType: () => contentType,
    getBytes: () => bytes,
    getSize: () => (size !== null ? size : bytes.length),
    copyBlob: function () {
      return this
    },
    bytes: bytes,
  }
}

describe('Drive Attachment Persistence along Taxonomy Path', () => {
  describe('isCanonicalClassification', () => {
    test('returns true for 7 standard canonical domains', () => {
      const domains = [
        '01_Household',
        '02_Finance_Legal',
        '03_Vehicles',
        '04_Family_Health',
        '05_Tech_Infrastructure',
        '06_Work_Career',
        '07_Community_NonProfit',
      ]
      domains.forEach((d) => {
        expect(isCanonicalClassification({ canonicalDomain: d })).toBe(true)
        expect(isCanonicalClassification({ canonical_label: d })).toBe(true)
      })
    })

    test('returns true for compound domain labels', () => {
      expect(
        isCanonicalClassification({
          canonical_label: '02_Finance_Legal/Banking',
        })
      ).toBe(true)
      expect(
        isCanonicalClassification({
          canonicalDomain: '01_Household/Primary_House',
        })
      ).toBe(true)
    })

    test('returns false for null, undefined, empty, or string "null"', () => {
      expect(isCanonicalClassification(null)).toBe(false)
      expect(isCanonicalClassification({})).toBe(false)
      expect(isCanonicalClassification({ canonicalDomain: null })).toBe(false)
      expect(isCanonicalClassification({ canonicalDomain: '' })).toBe(false)
      expect(isCanonicalClassification({ canonicalDomain: 'null' })).toBe(false)
      expect(isCanonicalClassification({ canonicalDomain: 'undefined' })).toBe(
        false
      )
    })

    test('returns false for non-canonical categories (promotions, newsletters, spam)', () => {
      expect(
        isCanonicalClassification({
          canonicalDomain: null,
          category: 'Promotions',
        })
      ).toBe(false)
      expect(
        isCanonicalClassification({
          canonicalDomain: 'Unknown_Category',
        })
      ).toBe(false)
    })
  })

  describe('resolveTaxonomySubfolderName', () => {
    test('resolves known sublabels to standardized subfolders', () => {
      expect(
        resolveTaxonomySubfolderName('02_Finance_Legal', 'Finance/Banking')
      ).toBe('Banking')
      expect(
        resolveTaxonomySubfolderName('02_Finance_Legal', 'Finance/Bills')
      ).toBe('Bills')
      expect(
        resolveTaxonomySubfolderName('02_Finance_Legal', 'Finance/Taxes')
      ).toBe('Taxes')
      expect(
        resolveTaxonomySubfolderName(
          '01_Household',
          'Household/Primary-Property'
        )
      ).toBe('Primary_House')
      expect(
        resolveTaxonomySubfolderName('03_Vehicles', 'Vehicles/Maintenance')
      ).toBe('Maintenance')
      expect(
        resolveTaxonomySubfolderName('04_Family_Health', 'Family/Medical')
      ).toBe('Medical_Records')
      expect(
        resolveTaxonomySubfolderName(
          '05_Tech_Infrastructure',
          'Tech/Alerts-Monitoring'
        )
      ).toBe('NAS_Backups')
    })

    test('sanitizes unknown sublabels cleanly', () => {
      expect(
        resolveTaxonomySubfolderName(
          '02_Finance_Legal',
          'Finance/Direct-Deposit'
        )
      ).toBe('Direct_Deposit')
      expect(
        resolveTaxonomySubfolderName('01_Household', 'Remodeling Bids')
      ).toBe('Remodeling_Bids')
    })

    test('falls back to default subfolder per domain when subLabel is omitted', () => {
      expect(resolveTaxonomySubfolderName('01_Household')).toBe('Primary_House')
      expect(resolveTaxonomySubfolderName('02_Finance_Legal')).toBe('Banking')
      expect(resolveTaxonomySubfolderName('03_Vehicles')).toBe('Maintenance')
      expect(resolveTaxonomySubfolderName('04_Family_Health')).toBe(
        'Medical_Records'
      )
      expect(resolveTaxonomySubfolderName('05_Tech_Infrastructure')).toBe(
        'NAS_Backups'
      )
      expect(resolveTaxonomySubfolderName('06_Work_Career')).toBe(
        'Career_Interviews'
      )
      expect(resolveTaxonomySubfolderName('07_Community_NonProfit')).toBe(
        'Community_BOD'
      )
    })
  })

  describe('isEligibleAttachment', () => {
    test('returns false for null or empty attachments', () => {
      expect(isEligibleAttachment(null)).toBe(false)
      expect(isEligibleAttachment({})).toBe(false)
      expect(isEligibleAttachment({ getName: () => '' })).toBe(false)
    })

    test('returns false for zero-byte attachments', () => {
      const emptyAtt = createMockAttachment({
        name: 'empty.pdf',
        content: '',
        size: 0,
      })
      expect(isEligibleAttachment(emptyAtt)).toBe(false)
    })

    test('filters out small image files (< 15KB) as signature/tracking pixels', () => {
      const pixelImg = createMockAttachment({
        name: 'icon.png',
        contentType: 'image/png',
        content: 'small',
        size: 2048, // 2KB
      })
      expect(isEligibleAttachment(pixelImg)).toBe(false)

      const sigImg = createMockAttachment({
        name: 'signature.jpg',
        contentType: 'image/jpeg',
        content: 'sig',
        size: 8192, // 8KB
      })
      expect(isEligibleAttachment(sigImg)).toBe(false)
    })

    test('filters out known tracking names (< 25KB)', () => {
      const trackingAtt = createMockAttachment({
        name: 'image001.png',
        contentType: 'image/png',
        content: 'img',
        size: 18000, // 18KB (< 25KB)
      })
      expect(isEligibleAttachment(trackingAtt)).toBe(false)
    })

    test('supports getBytes, bytes, and size fallbacks', () => {
      const attWithGetBytes = {
        getName: () => 'document.pdf',
        getBytes: () => Buffer.from('hello-world-12345'),
      }
      expect(isEligibleAttachment(attWithGetBytes)).toBe(true)

      const attWithEmptyBytes = {
        getName: () => 'empty.pdf',
        getBytes: () => null,
      }
      expect(isEligibleAttachment(attWithEmptyBytes)).toBe(false)

      const attWithBytesProp = {
        getName: () => 'document2.pdf',
        bytes: Buffer.from('hello-world-12345'),
      }
      expect(isEligibleAttachment(attWithBytesProp)).toBe(true)

      const attWithSizeProp = {
        name: 'document3.pdf',
        size: 5000,
      }
      expect(isEligibleAttachment(attWithSizeProp)).toBe(true)

      const smallNonTrackingImage = {
        name: 'other_small.png',
        contentType: 'image/png',
        size: 5000,
      }
      expect(isEligibleAttachment(smallNonTrackingImage)).toBe(false)
    })

    test('accepts document attachments of all types', () => {
      const docs = [
        'water_bill.pdf',
        'contract.docx',
        'payroll.xlsx',
        'export.csv',
        'notes.txt',
        'archive.zip',
      ]
      docs.forEach((d) => {
        const att = createMockAttachment({ name: d, size: 5000 })
        expect(isEligibleAttachment(att)).toBe(true)
      })
    })

    test('accepts substantive image attachments (>= 15KB)', () => {
      const photoAtt = createMockAttachment({
        name: 'receipt_scan.jpg',
        contentType: 'image/jpeg',
        content: 'real photo data',
        size: 45000, // 45KB
      })
      expect(isEligibleAttachment(photoAtt)).toBe(true)
    })
  })

  describe('ensureDriveTaxonomyFolder', () => {
    test('creates 2-level taxonomy folder idempotently', () => {
      const driveApp = createMockDriveApp()
      const folder = ensureDriveTaxonomyFolder(
        '02_Finance_Legal',
        'Banking',
        driveApp
      )

      expect(folder).toBeDefined()
      expect(folder.getName()).toBe('Banking')

      // Call second time to verify idempotency
      const folder2 = ensureDriveTaxonomyFolder(
        '02_Finance_Legal',
        'Banking',
        driveApp
      )
      expect(folder2).toBe(folder)
    })

    test('throws error if driveApp is unavailable', () => {
      expect(() =>
        ensureDriveTaxonomyFolder('01_Household', 'Bills', null)
      ).toThrow('DriveApp service unavailable')
    })

    test('returns domain folder when subfolderName is empty or omitted', () => {
      const driveApp = createMockDriveApp()
      const folder = ensureDriveTaxonomyFolder('01_Household', '', driveApp)
      expect(folder).toBeDefined()
      expect(folder.getName()).toBe('01_Household')
    })

    test('throws error when root folder is invalid', () => {
      expect(() =>
        ensureDriveTaxonomyFolder('01_Household', 'Bills', {})
      ).toThrow('DriveApp service unavailable or invalid root folder')
    })
  })

  describe('isDuplicateAttachment & resolveAttachmentName', () => {
    test('identifies exact duplicate file by size and MD5 hash', () => {
      const folder = createMockFolder('Bills')
      const blob1 = createMockAttachment({
        name: 'water_bill.pdf',
        content: 'Water bill content 12345',
      })
      folder.createFile(blob1)

      const existingFiles = folder.getFilesByName('water_bill.pdf')
      const blobSame = createMockAttachment({
        name: 'water_bill.pdf',
        content: 'Water bill content 12345',
      })

      expect(isDuplicateAttachment(existingFiles, blobSame)).toBe(true)
    })

    test('returns false when content differs even if name is identical', () => {
      const folder = createMockFolder('Bills')
      const blob1 = createMockAttachment({
        name: 'water_bill.pdf',
        content: 'Water bill content for August',
      })
      folder.createFile(blob1)

      const existingFiles = folder.getFilesByName('water_bill.pdf')
      const blobDiff = createMockAttachment({
        name: 'water_bill.pdf',
        content: 'Water bill content for September (different)',
      })

      expect(isDuplicateAttachment(existingFiles, blobDiff)).toBe(false)
    })

    test('returns false when existingFiles is missing or has no hasNext', () => {
      expect(isDuplicateAttachment(null, createMockAttachment())).toBe(false)
      expect(isDuplicateAttachment({}, createMockAttachment())).toBe(false)
    })

    test('supports newFileBlob as Buffer or object with bytes or null', () => {
      const folder = createMockFolder('Bills')
      const existing = folder.getFilesByName('file.pdf')
      const buf = Buffer.from('test')
      expect(isDuplicateAttachment(existing, buf)).toBe(false)
      expect(isDuplicateAttachment(existing, { bytes: buf })).toBe(false)
      expect(isDuplicateAttachment(existing, null)).toBe(false)
    })

    test('checks size property on existing file if getSize is missing', () => {
      const mockExisting = {
        hasNext: jest.fn().mockReturnValueOnce(true).mockReturnValueOnce(false),
        next: () => ({
          size: 10,
          getBlob: () => ({ getBytes: () => Buffer.from('1234567890') }),
        }),
      }
      const newBlob = {
        getBytes: () => Buffer.from('1234567890'),
      }
      expect(isDuplicateAttachment(mockExisting, newBlob)).toBe(true)
    })

    test('handles fallback when blob or file has no size or byte accessors', () => {
      const mockFolder = createMockFolder('Bills')
      const existing = mockFolder.getFilesByName('file.pdf')
      expect(isDuplicateAttachment(existing, {})).toBe(false)

      const faultyBlob = {
        getBytes: () => {
          throw new Error('Hash calculation error')
        },
      }
      expect(isDuplicateAttachment(existing, faultyBlob)).toBe(false)

      const fileWithoutSizeOrGetSize = {
        hasNext: jest.fn().mockReturnValueOnce(true).mockReturnValueOnce(false),
        next: () => ({
          getBlob: () => ({ bytes: Buffer.from('') }),
        }),
      }
      expect(
        isDuplicateAttachment(fileWithoutSizeOrGetSize, {
          bytes: Buffer.from(''),
        })
      ).toBe(true)
    })

    test('resolveAttachmentName appends timestamp when file of same name exists with different content', () => {
      const folder = createMockFolder('Bills')
      const blob1 = createMockAttachment({
        name: 'bill.pdf',
        content: 'A',
      })
      folder.createFile(blob1)

      const blob2 = createMockAttachment({
        name: 'bill.pdf',
        content: 'B',
      })
      const resolved = resolveAttachmentName(folder, 'bill.pdf', blob2, {})
      expect(resolved).not.toBe('bill.pdf')
      expect(resolved).toMatch(/^bill_[\w-]+\.pdf$/)
      expect(blob2.getName()).toBe(resolved)
    })
  })

  describe('persistCanonicalAttachmentsToDrive', () => {
    test('STRICT NON-CANONICAL GATE: strictly skips attachments for non-canonical emails', () => {
      const driveApp = createMockDriveApp()
      const thread = {
        getMessages: () => [
          {
            getAttachments: () => [
              createMockAttachment({ name: 'coupon.pdf', content: 'discount' }),
            ],
          },
        ],
      }
      const nonCanonicalClassification = {
        canonicalDomain: null,
        category: 'Promotions',
        action: 'archive',
      }
      const config = {
        canonicalDomains: ['01_Household', '02_Finance_Legal'],
      }

      const results = persistCanonicalAttachmentsToDrive(
        thread,
        nonCanonicalClassification,
        config,
        { DriveApp: driveApp }
      )

      expect(results).toEqual([])
      // Verify nothing created in drive
      const root = driveApp.getRootFolder()
      expect(root._subfolders.size).toBe(0)
    })

    test('persists eligible attachments to correct taxonomy path for canonical emails', () => {
      const driveApp = createMockDriveApp()
      const thread = {
        getMessages: () => [
          {
            getAttachments: () => [
              createMockAttachment({
                name: 'caw_funding_details.pdf',
                content: 'Central Alabama Water Funding Details',
              }),
              createMockAttachment({
                name: 'logo.png',
                contentType: 'image/png',
                content: 'small',
                size: 1024, // 1KB tracking pixel -> must be ignored!
              }),
            ],
          },
        ],
      }
      const canonicalClassification = {
        canonicalDomain: '02_Finance_Legal',
        subLabel: 'Finance/Banking',
        confidence: 0.98,
      }
      const config = {
        canonicalDomains: ['01_Household', '02_Finance_Legal'],
      }

      const results = persistCanonicalAttachmentsToDrive(
        thread,
        canonicalClassification,
        config,
        { DriveApp: driveApp }
      )

      expect(results).toHaveLength(1)
      expect(results[0].name).toBe('caw_funding_details.pdf')
      expect(results[0].domain).toBe('02_Finance_Legal')
      expect(results[0].subfolder).toBe('Banking')
      expect(results[0].url).toContain('https://drive.google.com/file/d/')

      // Verify folder hierarchy
      const root = driveApp.getRootFolder()
      const domainFolder = root._subfolders.get('02_Finance_Legal')
      expect(domainFolder).toBeDefined()
      const subFolder = domainFolder._subfolders.get('Banking')
      expect(subFolder).toBeDefined()
      expect(subFolder._files.get('caw_funding_details.pdf')).toHaveLength(1)
      expect(subFolder._files.has('logo.png')).toBe(false)
    })

    test('deduplicates when same attachment is re-processed', () => {
      const driveApp = createMockDriveApp()
      const att = createMockAttachment({
        name: 'statement.pdf',
        content: 'Bank statement content 2026-09',
      })
      const thread = {
        getMessages: () => [{ getAttachments: () => [att] }],
      }
      const classification = {
        canonicalDomain: '02_Finance_Legal',
        subLabel: 'Finance/Banking',
      }
      const config = { canonicalDomains: ['02_Finance_Legal'] }

      // First run saves
      const results1 = persistCanonicalAttachmentsToDrive(
        thread,
        classification,
        config,
        { DriveApp: driveApp }
      )
      expect(results1).toHaveLength(1)

      // Second run detects duplicate and skips
      const results2 = persistCanonicalAttachmentsToDrive(
        thread,
        classification,
        config,
        { DriveApp: driveApp }
      )
      expect(results2).toHaveLength(0)
    })

    test('returns empty array when DriveApp is unavailable in services or global', () => {
      const thread = { getMessages: () => [] }
      const classification = { canonicalDomain: '01_Household' }
      const results = persistCanonicalAttachmentsToDrive(
        thread,
        classification,
        { canonicalDomains: ['01_Household'] },
        { DriveApp: null }
      )
      expect(results).toEqual([])
    })

    test('handles error when ensureDriveTaxonomyFolder throws', () => {
      const thread = { getMessages: () => [] }
      const classification = { canonicalDomain: '01_Household' }
      const results = persistCanonicalAttachmentsToDrive(
        thread,
        classification,
        { canonicalDomains: ['01_Household'] },
        { DriveApp: { getRootFolder: () => ({}) } }
      )
      expect(results).toEqual([])
    })

    test('catches and logs error when targetFolder.createFile throws', () => {
      const att = createMockAttachment({ name: 'bill.pdf', size: 1000 })
      const thread = {
        getMessages: () => [{ getAttachments: () => [att] }],
      }
      const driveApp = {
        getRootFolder: () => ({
          getFoldersByName: () => ({
            hasNext: () => true,
            next: () => ({
              getFoldersByName: () => ({
                hasNext: () => true,
                next: () => ({
                  getFilesByName: () => ({ hasNext: () => false }),
                  createFile: () => {
                    throw new Error('Disk quota exceeded')
                  },
                }),
              }),
            }),
          }),
        }),
      }
      const results = persistCanonicalAttachmentsToDrive(
        thread,
        { canonicalDomain: '01_Household' },
        { canonicalDomains: ['01_Household'] },
        { DriveApp: driveApp }
      )
      expect(results).toEqual([])
    })
  })

  describe('formatProgressiveDisclosureEntry with Attachments', () => {
    test('renders clean markdown without attachments when none provided', () => {
      const entry = formatProgressiveDisclosureEntry(
        '2026-09-28',
        'Water Bill Notice',
        'billing@caw-al.gov',
        'Account Update',
        'Notice of water bill update.',
        'user@example.com'
      )
      expect(entry).toContain('### 2026-09-28 — Water Bill Notice')
      expect(entry).toContain('- **From**: billing@caw-al.gov')
      expect(entry).not.toContain('**Attachments**:')
    })

    test('renders clickable Drive links when attachments are provided', () => {
      const attachments = [
        {
          name: 'Central_Alabama_Water_Bill.pdf',
          url: 'https://drive.google.com/file/d/test-id-123/view',
        },
      ]
      const entry = formatProgressiveDisclosureEntry(
        '2026-09-28',
        'Water Bill Notice',
        'billing@caw-al.gov',
        'Account Update',
        'Notice of water bill update.',
        'user@example.com',
        attachments
      )

      expect(entry).toContain('- **Attachments**:\n')
      expect(entry).toContain(
        '  - [Central_Alabama_Water_Bill.pdf](https://drive.google.com/file/d/test-id-123/view)'
      )
    })

    test('renders plain attachment name when url is not provided', () => {
      const attachments = [{ name: 'document_without_link.pdf' }]
      const entry = formatProgressiveDisclosureEntry(
        '2026-09-28',
        'Water Bill Notice',
        'billing@caw-al.gov',
        'Account Update',
        'Notice of water bill update.',
        'user@example.com',
        attachments
      )

      expect(entry).toContain('- **Attachments**:\n')
      expect(entry).toContain('  - document_without_link.pdf\n')
    })
  })
})
