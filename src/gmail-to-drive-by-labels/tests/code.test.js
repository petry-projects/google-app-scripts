const { createMessage, createBlob } = require('../../../test-utils/mocks');

// Mock getProcessConfig
global.getProcessConfig = jest.fn(() => [
  {
    triggerLabel: 'test-trigger',
    processedLabel: 'test-archived',
    docId: 'test-doc',
    folderId: 'test-folder'
  }
]);

// Load code.gs functions
const { storeEmailsAndAttachments, processLabelGroup } = require('../code.gs');

describe('storeEmailsAndAttachments', () => {
  beforeEach(() => {
    global.__mocks.docs.__reset();
    global.__mocks.gmail.__reset();
    global.__mocks.drive.__reset();
    global.PropertiesService.__reset();
    jest.clearAllMocks();
  });

  test('processes all configurations', () => {
    // Setup: Create labels and add threads
    const triggerLabel = global.GmailApp.createLabel('test-trigger');
    global.GmailApp.createLabel('test-archived');
    
    const msg = createMessage({
      subject: 'Test Email',
      body: 'Test content',
      date: new Date('2024-01-01T10:00:00Z')
    });
    
    global.GmailApp.__addThreadWithLabels(['test-trigger'], [msg]);
    
    // Setup: Create doc and folder
    const doc = global.DocumentApp.openById('test-doc');
    global.DriveApp.getFolderById('test-folder');
    
    // Run
    storeEmailsAndAttachments();
    
    // Verify: Thread was processed and moved to archived label
    expect(triggerLabel.getThreads().length).toBe(0);
    const archivedLabel = global.GmailApp.getUserLabelByName('test-archived');
    expect(archivedLabel.getThreads().length).toBe(1);
    
    // Verify: Content was added to document
    const body = doc.getBody();
    const paragraphs = body.getParagraphs();
    expect(paragraphs.length).toBeGreaterThan(0);
  });

  test('processes multiple configurations', () => {
    // Setup multiple configs
    global.getProcessConfig.mockReturnValue([
      {
        triggerLabel: 'label-1',
        processedLabel: 'label-1-archived',
        docId: 'doc-1',
        folderId: 'folder-1'
      },
      {
        triggerLabel: 'label-2',
        processedLabel: 'label-2-archived',
        docId: 'doc-2',
        folderId: 'folder-2'
      }
    ]);
    
    // Setup labels and threads for both configs
    global.GmailApp.createLabel('label-1');
    global.GmailApp.createLabel('label-1-archived');
    global.GmailApp.createLabel('label-2');
    global.GmailApp.createLabel('label-2-archived');
    
    const msg1 = createMessage({ subject: 'Email 1', body: 'Body 1' });
    const msg2 = createMessage({ subject: 'Email 2', body: 'Body 2' });
    
    global.GmailApp.__addThreadWithLabels(['label-1'], [msg1]);
    global.GmailApp.__addThreadWithLabels(['label-2'], [msg2]);
    
    global.DocumentApp.openById('doc-1');
    global.DocumentApp.openById('doc-2');
    global.DriveApp.getFolderById('folder-1');
    global.DriveApp.getFolderById('folder-2');
    
    // Run
    storeEmailsAndAttachments();
    
    // Verify both configs were processed
    const archived1 = global.GmailApp.getUserLabelByName('label-1-archived');
    const archived2 = global.GmailApp.getUserLabelByName('label-2-archived');
    expect(archived1.getThreads().length).toBe(1);
    expect(archived2.getThreads().length).toBe(1);
  });

  test('handles pause when rebuild does not complete', () => {
    // Import rebuildAllDocs
    const { rebuildAllDocs } = require('../code.gs');
    
    // Setup config with many threads to trigger timeout simulation
    global.getProcessConfig.mockReturnValue([
      {
        triggerLabel: 'test-trigger',
        processedLabel: 'test-archived',
        docId: 'test-doc',
        folderId: 'test-folder'
      }
    ]);
    
    global.GmailApp.createLabel('test-trigger');
    const processedLabel = global.GmailApp.createLabel('test-archived');
    
    // Add many threads to processed label
    for (let i = 0; i < 150; i++) {
      const msg = createMessage({ subject: `Email ${i}`, body: `Body ${i}` });
      global.GmailApp.__addThreadWithLabels(['test-archived'], [msg]);
    }
    
    global.DocumentApp.openById('test-doc');
    
    // Mock Date to simulate timeout
    const originalDate = Date;
    let callCount = 0;
    global.Date = class extends originalDate {
      getTime() {
        callCount++;
        if (callCount > 50) {
          return 5 * 60 * 1000; // 5 minutes - exceeds threshold
        }
        return 0;
      }
    };
    
    // Run - should pause due to simulated timeout
    rebuildAllDocs();
    
    // Restore Date
    global.Date = originalDate;
    
    // Should have processed some but not all threads
    expect(processedLabel.getThreads().length).toBeLessThan(150);
    expect(processedLabel.getThreads().length).toBeGreaterThan(0);
  });
});

describe('processLabelGroup', () => {
  beforeEach(() => {
    global.__mocks.docs.__reset();
    global.__mocks.gmail.__reset();
    global.__mocks.drive.__reset();
    jest.clearAllMocks();
  });

  test('processes emails and adds them to document', () => {
    // Setup
    const triggerLabel = global.GmailApp.createLabel('test-trigger');
    global.GmailApp.createLabel('test-archived');
    
    // Create messages with different dates to test sorting
    const msg1 = createMessage({
      subject: 'Oldest Email',
      body: 'Body 1',
      date: new Date('2024-01-01T10:00:00Z')
    });
    const msg2 = createMessage({
      subject: 'Newest Email',
      body: 'Body 2',
      date: new Date('2024-01-01T12:00:00Z')
    });
    const msg3 = createMessage({
      subject: 'Middle Email',
      body: 'Body 3',
      date: new Date('2024-01-01T11:00:00Z')
    });
    
    // Add in non-sorted order
    global.GmailApp.__addThreadWithLabels(['test-trigger'], [msg2, msg1, msg3]);
    
    const doc = global.DocumentApp.openById('test-doc');
    const body = doc.getBody();
    global.DriveApp.getFolderById('test-folder');
    
    // Run
    const config = {
      triggerLabel: 'test-trigger',
      processedLabel: 'test-archived',
      docId: 'test-doc',
      folderId: 'test-folder'
    };
    processLabelGroup(config);
    
    // Verify
    expect(triggerLabel.getThreads().length).toBe(0);
    const archived = global.GmailApp.getUserLabelByName('test-archived');
    expect(archived.getThreads().length).toBe(1);
    
    const paragraphs = body.getParagraphs();
    expect(paragraphs.length).toBeGreaterThan(0);
    
    // Verify messages are in order (newest first in doc due to prepend)
    const subjectParas = paragraphs.filter(p => p.getText().includes('Subject:'));
    expect(subjectParas[0].getText()).toContain('Newest Email');
    expect(subjectParas[1].getText()).toContain('Middle Email');
    expect(subjectParas[2].getText()).toContain('Oldest Email');
  });

  test('creates processed label if it does not exist', () => {
    // Setup - no processed label exists
    const triggerLabel = global.GmailApp.createLabel('test-trigger');
    
    const msg = createMessage({ subject: 'Test', body: 'Body' });
    global.GmailApp.__addThreadWithLabels(['test-trigger'], [msg]);
    
    global.DocumentApp.openById('test-doc');
    global.DriveApp.getFolderById('test-folder');
    
    // Verify processed label doesn't exist yet
    expect(global.GmailApp.getUserLabelByName('test-archived')).toBeNull();
    
    // Run
    const config = {
      triggerLabel: 'test-trigger',
      processedLabel: 'test-archived',
      docId: 'test-doc',
      folderId: 'test-folder'
    };
    processLabelGroup(config);
    
    // Verify processed label was created
    const archived = global.GmailApp.getUserLabelByName('test-archived');
    expect(archived).not.toBeNull();
    expect(archived.getThreads().length).toBe(1);
  });

  test('returns early if trigger label not found', () => {
    // Setup - trigger label doesn't exist
    global.DocumentApp.openById('test-doc');
    global.DriveApp.getFolderById('test-folder');
    
    // Run
    const config = {
      triggerLabel: 'non-existent-label',
      processedLabel: 'test-archived',
      docId: 'test-doc',
      folderId: 'test-folder'
    };
    
    // Should not throw
    expect(() => processLabelGroup(config)).not.toThrow();
  });

  test('returns early if no threads found', () => {
    // Setup - label exists but has no threads
    global.GmailApp.createLabel('test-trigger');
    global.GmailApp.createLabel('test-archived');
    global.DocumentApp.openById('test-doc');
    global.DriveApp.getFolderById('test-folder');
    
    // Run
    const config = {
      triggerLabel: 'test-trigger',
      processedLabel: 'test-archived',
      docId: 'test-doc',
      folderId: 'test-folder'
    };
    
    // Should not throw
    expect(() => processLabelGroup(config)).not.toThrow();
  });

  test('handles document opening errors', () => {
    // Setup
    const triggerLabel = global.GmailApp.createLabel('test-trigger');
    const msg = createMessage({ subject: 'Test', body: 'Body' });
    global.GmailApp.__addThreadWithLabels(['test-trigger'], [msg]);
    
    // Mock DocumentApp.openById to throw error
    const originalOpenById = global.DocumentApp.openById;
    global.DocumentApp.openById = jest.fn(() => {
      throw new Error('Document not found');
    });
    
    // Run with doc that throws error
    const config = {
      triggerLabel: 'test-trigger',
      processedLabel: 'test-archived',
      docId: 'error-doc',
      folderId: 'test-folder'
    };
    
    // Should not throw
    expect(() => processLabelGroup(config)).not.toThrow();
    
    // Thread should not be moved since processing failed
    expect(triggerLabel.getThreads().length).toBe(1);
    
    // Restore
    global.DocumentApp.openById = originalOpenById;
  });

  test('handles label creation error gracefully', () => {
    // Setup
    const triggerLabel = global.GmailApp.createLabel('test-trigger');
    const msg = createMessage({ subject: 'Test', body: 'Body' });
    global.GmailApp.__addThreadWithLabels(['test-trigger'], [msg]);
    
    global.DocumentApp.openById('test-doc');
    global.DriveApp.getFolderById('test-folder');
    
    // Mock createLabel to throw error
    const originalCreateLabel = global.GmailApp.createLabel;
    global.GmailApp.createLabel = jest.fn(() => {
      throw new Error('Cannot create label');
    });
    
    // Run - processed label doesn't exist and creation will fail
    const config = {
      triggerLabel: 'test-trigger',
      processedLabel: 'new-archived-label',
      docId: 'test-doc',
      folderId: 'test-folder'
    };
    
    // Should not throw
    expect(() => processLabelGroup(config)).not.toThrow();
    
    // Restore
    global.GmailApp.createLabel = originalCreateLabel;
    
    // Thread should still be moved (label creation error is non-fatal)
    expect(triggerLabel.getThreads().length).toBe(0);
  });

  test('processes attachments with deduplication', () => {
    // Setup
    global.GmailApp.createLabel('test-trigger');
    global.GmailApp.createLabel('test-archived');
    
    const attachment = createBlob('file content', 'test.txt');
    const msg = createMessage({
      subject: 'Email with attachment',
      body: 'Body content',
      attachments: [attachment]
    });
    
    global.GmailApp.__addThreadWithLabels(['test-trigger'], [msg]);
    
    const doc = global.DocumentApp.openById('test-doc');
    const folder = global.DriveApp.getFolderById('test-folder');
    
    // Run
    const config = {
      triggerLabel: 'test-trigger',
      processedLabel: 'test-archived',
      docId: 'test-doc',
      folderId: 'test-folder'
    };
    processLabelGroup(config);
    
    // Verify attachment was saved
    const files = folder.__getFiles();
    expect(files.length).toBe(1);
    expect(files[0].getName()).toBe('test.txt');
    
    // Verify document mentions attachment
    const body = doc.getBody();
    const paragraphs = body.getParagraphs();
    const attachmentMentioned = paragraphs.some(p => 
      p.getText().includes('[Attachments]') || p.getText().includes('test.txt')
    );
    expect(attachmentMentioned).toBe(true);
  });

  test('skips duplicate attachments', () => {
    // Setup
    global.GmailApp.createLabel('test-trigger');
    global.GmailApp.createLabel('test-archived');
    
    const folder = global.DriveApp.getFolderById('test-folder');
    
    // Pre-create the attachment in the folder with EXACT same content
    const existingBlob = createBlob('exactly the same content', 'duplicate.txt');
    folder.createFile(existingBlob);
    
    // Create email with same attachment (exact same content and size)
    const attachment = createBlob('exactly the same content', 'duplicate.txt');
    const msg = createMessage({
      subject: 'Email with duplicate',
      body: 'Body',
      attachments: [attachment]
    });
    
    global.GmailApp.__addThreadWithLabels(['test-trigger'], [msg]);
    
    const doc = global.DocumentApp.openById('test-doc');
    
    // Run
    const config = {
      triggerLabel: 'test-trigger',
      processedLabel: 'test-archived',
      docId: 'test-doc',
      folderId: 'test-folder'
    };
    processLabelGroup(config);
    
    // Verify attachment was NOT duplicated (still only 1 file)
    const files = folder.__getFiles();
    expect(files.length).toBe(1);
    
    // Verify document shows it was skipped
    const body = doc.getBody();
    const paragraphs = body.getParagraphs();
    const skipMentioned = paragraphs.some(p => 
      p.getText().includes('DUPLICATE SKIPPED')
    );
    expect(skipMentioned).toBe(true);
  });

  test('detects different content with same size', () => {
    // Setup
    global.GmailApp.createLabel('test-trigger');
    global.GmailApp.createLabel('test-archived');
    
    const folder = global.DriveApp.getFolderById('test-folder');
    
    // Pre-create file with same size but different content
    const existingBlob = createBlob('content123', 'file.txt'); // 10 bytes
    folder.createFile(existingBlob);
    
    // Create email with attachment that has same size, different content
    const attachment = createBlob('different', 'file.txt'); // 9 bytes - actually different size
    // Let's use same-length content
    const attachment2 = createBlob('contenz456', 'file.txt'); // 10 bytes, different content
    const msg = createMessage({
      subject: 'Email',
      body: 'Body',
      attachments: [attachment2]
    });
    
    global.GmailApp.__addThreadWithLabels(['test-trigger'], [msg]);
    
    const doc = global.DocumentApp.openById('test-doc');
    
    // Run
    const config = {
      triggerLabel: 'test-trigger',
      processedLabel: 'test-archived',
      docId: 'test-doc',
      folderId: 'test-folder'
    };
    processLabelGroup(config);
    
    // Verify we now have 2 files (original + renamed due to hash mismatch)
    const files = folder.__getFiles();
    expect(files.length).toBe(2);
  });

  test('renames attachment when name conflicts but content differs', () => {
    // Setup
    global.GmailApp.createLabel('test-trigger');
    global.GmailApp.createLabel('test-archived');
    
    const folder = global.DriveApp.getFolderById('test-folder');
    
    // Pre-create file with same name but different content
    const existingBlob = createBlob('different content', 'file.txt');
    folder.createFile(existingBlob);
    
    // Create email with attachment that has same name, different content
    const attachment = createBlob('new content', 'file.txt');
    const msg = createMessage({
      subject: 'Email with conflict',
      body: 'Body',
      attachments: [attachment]
    });
    
    global.GmailApp.__addThreadWithLabels(['test-trigger'], [msg]);
    
    const doc = global.DocumentApp.openById('test-doc');
    
    // Run
    const config = {
      triggerLabel: 'test-trigger',
      processedLabel: 'test-archived',
      docId: 'test-doc',
      folderId: 'test-folder'
    };
    processLabelGroup(config);
    
    // Verify we now have 2 files (original + renamed)
    const files = folder.__getFiles();
    expect(files.length).toBe(2);
    
    // One should be the original name, other should be renamed
    const names = files.map(f => f.getName()).sort();
    expect(names[0]).toBe('file.txt');
    expect(names[1]).toMatch(/file.*\.txt/); // Should have timestamp inserted
  });

  test('handles setHeading error with fallback to bold', () => {
    // Setup
    global.GmailApp.createLabel('test-trigger');
    global.GmailApp.createLabel('test-archived');
    
    const msg = createMessage({
      subject: 'Test Subject',
      body: 'Test body'
    });
    
    global.GmailApp.__addThreadWithLabels(['test-trigger'], [msg]);
    
    const doc = global.DocumentApp.openById('test-doc');
    const body = doc.getBody();
    global.DriveApp.getFolderById('test-folder');
    
    // Spy on insertParagraph and make setHeading throw for subject line
    const originalInsertParagraph = body.insertParagraph.bind(body);
    let setHeadingThrew = false;
    
    body.insertParagraph = (index, text) => {
      const para = originalInsertParagraph(index, text);
      
      // Make setHeading throw for subject line
      if (text && text.includes('Subject:')) {
        const originalSetHeading = para.setHeading;
        para.setHeading = (heading) => {
          setHeadingThrew = true;
          throw new Error('Document is busy');
        };
      }
      
      return para;
    };
    
    // Run
    const config = {
      triggerLabel: 'test-trigger',
      processedLabel: 'test-archived',
      docId: 'test-doc',
      folderId: 'test-folder'
    };
    
    // Should not throw - catch block should handle error
    expect(() => processLabelGroup(config)).not.toThrow();
    
    // Verify setHeading was called and threw
    expect(setHeadingThrew).toBe(true);
    
    // Verify content was still added despite the error
    const paragraphs = body.getParagraphs();
    expect(paragraphs.length).toBeGreaterThan(0);
    
    // Verify subject paragraph exists
    const subjectExists = paragraphs.some(p => p.getText().includes('Test Subject'));
    expect(subjectExists).toBe(true);
  });

  test('processes email body with reply headers using getCleanBody', () => {
    // Setup
    global.GmailApp.createLabel('test-trigger');
    global.GmailApp.createLabel('test-archived');
    
    // Create message with Gmail reply header
    const bodyWithHeader = `This is the actual content.

On Mon, Jan 1, 2024 at 10:00 AM Someone <someone@example.com> wrote:
> This is quoted text that should be removed.
> More quoted text.`;
    
    const msg = createMessage({
      subject: 'Test Email',
      body: bodyWithHeader
    });
    
    global.GmailApp.__addThreadWithLabels(['test-trigger'], [msg]);
    
    const doc = global.DocumentApp.openById('test-doc');
    const body = doc.getBody();
    global.DriveApp.getFolderById('test-folder');
    
    // Run
    const config = {
      triggerLabel: 'test-trigger',
      processedLabel: 'test-archived',
      docId: 'test-doc',
      folderId: 'test-folder'
    };
    processLabelGroup(config);
    
    // Verify
    const paragraphs = body.getParagraphs();
    const bodyText = paragraphs.map(p => p.getText()).join('\n');
    
    // Should include the actual content
    expect(bodyText).toContain('This is the actual content');
    // Should NOT include the quoted reply
    expect(bodyText).not.toContain('This is quoted text that should be removed');
  });
});
