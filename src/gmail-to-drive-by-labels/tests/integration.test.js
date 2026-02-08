const { createMessage, createBlob } = require('../../../test-utils/mocks');
const { processMessageToDoc, processMessagesToDoc } = require('../src/index');

// This test uses the actual processing functions from src/index.js
// to verify that the prepend behavior works correctly end-to-end
describe('Gmail to Drive integration with prepend behavior', () => {
  let doc, body, folder, processedLabel;

  beforeEach(() => {
    global.__mocks.docs.__reset();
    global.__mocks.gmail.__reset();
    global.__mocks.drive.__reset();
    
    doc = global.DocumentApp.openById('test-doc');
    body = doc.getBody();
    folder = global.DriveApp.getFolderById('test-folder');
    
    // Create the processed label
    processedLabel = global.GmailApp.createLabel('test-archived');
  });

  test('processes emails and prepends them to document in newest-first order', () => {
    // Setup: Add trigger label and emails
    const triggerLabel = global.GmailApp.createLabel('test-trigger');
    
    // Create three messages in chronological order
    const msg1 = createMessage({
      subject: 'First Email',
      body: 'Content of first email',
      date: new Date('2024-01-01T10:00:00Z')
    });
    
    const msg2 = createMessage({
      subject: 'Second Email',
      body: 'Content of second email',
      date: new Date('2024-01-01T11:00:00Z')
    });
    
    const msg3 = createMessage({
      subject: 'Third Email',
      body: 'Content of third email',
      date: new Date('2024-01-01T12:00:00Z')
    });
    
    // Add them to a thread
    global.GmailApp.__addThreadWithLabels(['test-trigger'], [msg1, msg2, msg3]);
    
    // Process using the real function
    const threads = triggerLabel.getThreads();
    expect(threads.length).toBe(1);
    
    threads.forEach((thread) => {
      const messages = thread.getMessages();
      processMessagesToDoc(messages, body, folder);
    });
    
    // Verify: Most recent email should be at the top
    const paragraphs = body.getParagraphs();
    
    // Should have 4 paragraphs per email (subject, date, content, separator) × 3 emails = 12 paragraphs
    expect(paragraphs.length).toBe(12);
    
    // Third (most recent) email should be at top
    expect(paragraphs[0].getText()).toBe('Subject: Third Email');
    expect(paragraphs[1].getText()).toContain('2024');
    expect(paragraphs[2].getText()).toBe('Content of third email');
    expect(paragraphs[3].getText()).toBe('------------------------------');
    
    // Second email should be in middle
    expect(paragraphs[4].getText()).toBe('Subject: Second Email');
    expect(paragraphs[6].getText()).toBe('Content of second email');
    
    // First email should be at bottom
    expect(paragraphs[8].getText()).toBe('Subject: First Email');
    expect(paragraphs[10].getText()).toBe('Content of first email');
  });

  test('prepends email with attachments correctly using production deduplication logic', () => {
    const triggerLabel = global.GmailApp.createLabel('test-trigger');
    
    // Create attachments
    const attachment1 = createBlob('file content 1', 'file1.txt');
    const attachment2 = createBlob('file content 2', 'file2.pdf');
    
    const msg = createMessage({
      subject: 'Email with Attachments',
      body: 'Email body content',
      date: new Date('2024-01-01T10:00:00Z'),
      attachments: [attachment1, attachment2]
    });
    
    global.GmailApp.__addThreadWithLabels(['test-trigger'], [msg]);
    
    // Process using the real function
    const threads = triggerLabel.getThreads();
    const messages = threads[0].getMessages();
    
    processMessagesToDoc(messages, body, folder);
    
    // Verify structure
    const paragraphs = body.getParagraphs();
    expect(paragraphs[0].getText()).toBe('Subject: Email with Attachments');
    expect(paragraphs[3].getText()).toBe('[Attachments]:');
    expect(paragraphs[4].getText()).toBe('- file1.txt');
    expect(paragraphs[5].getText()).toBe('- file2.pdf');
    expect(paragraphs[6].getText()).toBe('------------------------------');
    
    // Verify files were created
    const files = folder.__getFiles();
    expect(files.length).toBe(2);
  });

  test('new emails prepend before existing document content', () => {
    // Pre-populate document with existing content
    body.appendParagraph('Subject: Old Email');
    body.appendParagraph('Date: 2023-12-31');
    body.appendParagraph('This is old content');
    body.appendParagraph('------------------------------');
    
    // Now process a new email
    const triggerLabel = global.GmailApp.createLabel('test-trigger');
    const msg = createMessage({
      subject: 'New Email',
      body: 'Fresh content',
      date: new Date('2024-01-01T10:00:00Z')
    });
    
    global.GmailApp.__addThreadWithLabels(['test-trigger'], [msg]);
    
    // Process using the real function
    const threads = triggerLabel.getThreads();
    const message = threads[0].getMessages()[0];
    
    processMessageToDoc(message, body, folder);
    
    // Verify new content is at top, old content at bottom
    const paragraphs = body.getParagraphs();
    expect(paragraphs.length).toBe(8);
    
    // New email at top
    expect(paragraphs[0].getText()).toBe('Subject: New Email');
    expect(paragraphs[2].getText()).toBe('Fresh content');
    
    // Old email at bottom
    expect(paragraphs[4].getText()).toBe('Subject: Old Email');
    expect(paragraphs[6].getText()).toBe('This is old content');
  });

  test('processes multiple threads and maintains newest-first ordering', () => {
    const triggerLabel = global.GmailApp.createLabel('test-trigger');
    
    // Create two separate threads (simulating different email conversations)
    const thread1Msg = createMessage({
      subject: 'Thread 1 Email',
      body: 'Thread 1 content',
      date: new Date('2024-01-01T10:00:00Z')
    });
    
    const thread2Msg = createMessage({
      subject: 'Thread 2 Email',
      body: 'Thread 2 content',
      date: new Date('2024-01-01T11:00:00Z')
    });
    
    global.GmailApp.__addThreadWithLabels(['test-trigger'], [thread1Msg]);
    global.GmailApp.__addThreadWithLabels(['test-trigger'], [thread2Msg]);
    
    // Process all threads using real function
    const threads = triggerLabel.getThreads();
    expect(threads.length).toBe(2);
    
    threads.forEach((thread) => {
      const messages = thread.getMessages();
      processMessagesToDoc(messages, body, folder);
    });
    
    // Verify both threads are in document
    const paragraphs = body.getParagraphs();
    expect(paragraphs.length).toBe(8);
    
    // Most recently processed thread should be at top
    expect(paragraphs[0].getText()).toBe('Subject: Thread 2 Email');
    expect(paragraphs[4].getText()).toBe('Subject: Thread 1 Email');
  });

  test('handles attachment deduplication correctly', () => {
    // Pre-create a file in the folder
    const existingBlob = createBlob('duplicate content', 'duplicate.txt');
    folder.createFile(existingBlob);
    
    // Create a message with the same attachment
    const duplicateAttachment = createBlob('duplicate content', 'duplicate.txt');
    const msg = createMessage({
      subject: 'Email with Duplicate',
      body: 'Test deduplication',
      date: new Date('2024-01-01T10:00:00Z'),
      attachments: [duplicateAttachment]
    });
    
    global.GmailApp.__addThreadWithLabels(['test-trigger'], [msg]);
    const threads = global.GmailApp.getUserLabelByName('test-trigger').getThreads();
    const messages = threads[0].getMessages();
    
    processMessagesToDoc(messages, body, folder);
    
    // Verify duplicate was skipped
    const paragraphs = body.getParagraphs();
    expect(paragraphs.some(p => p.getText().includes('[DUPLICATE SKIPPED]'))).toBe(true);
    
    // Should still only have 1 file (the original)
    const files = folder.__getFiles();
    expect(files.length).toBe(1);
  });

  test('handles attachment name conflicts with timestamp renaming', () => {
    // Pre-create a file with same name but different content
    const existingBlob = createBlob('original content', 'file.txt');
    folder.createFile(existingBlob);
    
    // Create a message with attachment that has same name but different content
    const newAttachment = createBlob('new content', 'file.txt');
    const msg = createMessage({
      subject: 'Email with Name Conflict',
      body: 'Test name conflict',
      date: new Date('2024-01-01T10:00:00Z'),
      attachments: [newAttachment]
    });
    
    global.GmailApp.__addThreadWithLabels(['test-trigger'], [msg]);
    const threads = global.GmailApp.getUserLabelByName('test-trigger').getThreads();
    const messages = threads[0].getMessages();
    
    processMessagesToDoc(messages, body, folder);
    
    // Should have 2 files now (original and renamed new one)
    const files = folder.__getFiles();
    expect(files.length).toBe(2);
    
    // New file should have timestamp in name
    const fileNames = files.map(f => f.getName());
    expect(fileNames).toContain('file.txt');
    expect(fileNames.some(name => name.startsWith('file_') && name.endsWith('.txt'))).toBe(true);
  });

  test('handles files with size mismatch correctly', () => {
    // Pre-create a file
    const existingBlob = createBlob('short content', 'test.txt');
    folder.createFile(existingBlob);
    
    // Create attachment with same name but different size
    const newAttachment = createBlob('much longer content here', 'test.txt');
    const msg = createMessage({
      subject: 'Email with Different Size',
      body: 'Test size mismatch',
      date: new Date('2024-01-01T10:00:00Z'),
      attachments: [newAttachment]
    });
    
    global.GmailApp.__addThreadWithLabels(['test-trigger'], [msg]);
    const threads = global.GmailApp.getUserLabelByName('test-trigger').getThreads();
    const messages = threads[0].getMessages();
    
    processMessagesToDoc(messages, body, folder);
    
    // Should have 2 files (size mismatch means not a duplicate)
    const files = folder.__getFiles();
    expect(files.length).toBe(2);
  });

  test('handles files with same size but different hash', () => {
    // Pre-create a file
    const existingBlob = createBlob('content_a', 'hash-test.txt');
    folder.createFile(existingBlob);
    
    // Create attachment with same name and size but different content
    const newAttachment = createBlob('content_b', 'hash-test.txt');
    const msg = createMessage({
      subject: 'Email with Hash Mismatch',
      body: 'Test hash comparison',
      date: new Date('2024-01-01T10:00:00Z'),
      attachments: [newAttachment]
    });
    
    global.GmailApp.__addThreadWithLabels(['test-trigger'], [msg]);
    const threads = global.GmailApp.getUserLabelByName('test-trigger').getThreads();
    const messages = threads[0].getMessages();
    
    processMessagesToDoc(messages, body, folder);
    
    // Should have 2 files (hash mismatch means different content)
    const files = folder.__getFiles();
    expect(files.length).toBe(2);
  });

  test('handles attachments with no file extension', () => {
    const attachment = createBlob('file content', 'README');
    const msg = createMessage({
      subject: 'Email with No Extension',
      body: 'Test file without extension',
      date: new Date('2024-01-01T10:00:00Z'),
      attachments: [attachment]
    });
    
    // Pre-create a file with same name to trigger renaming
    folder.createFile(createBlob('different content', 'README'));
    
    global.GmailApp.__addThreadWithLabels(['test-trigger'], [msg]);
    const threads = global.GmailApp.getUserLabelByName('test-trigger').getThreads();
    const messages = threads[0].getMessages();
    
    processMessagesToDoc(messages, body, folder);
    
    // Verify paragraph mentions the attachment
    const paragraphs = body.getParagraphs();
    expect(paragraphs.some(p => p.getText().includes('README'))).toBe(true);
    
    // Should have 2 files (original and new with timestamp)
    const files = folder.__getFiles();
    expect(files.length).toBe(2);
  });

  test('handles messages with Logger and DocumentApp options', () => {
    const msg = createMessage({
      subject: 'Test with Options',
      body: 'Testing Logger and DocumentApp',
      date: new Date('2024-01-01T10:00:00Z')
    });
    
    // Mock Logger and DocumentApp
    const mockLogger = {
      log: jest.fn()
    };
    
    const mockDocumentApp = {
      ParagraphHeading: { HEADING_3: 'HEADING_3' },
      Attribute: { BOLD: 'BOLD' }
    };
    
    const options = {
      Logger: mockLogger,
      DocumentApp: mockDocumentApp
    };
    
    processMessageToDoc(msg, body, folder, options);
    
    // Verify Logger was called
    expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('Test with Options'));
    
    // Verify message was added
    const paragraphs = body.getParagraphs();
    expect(paragraphs[0].getText()).toBe('Subject: Test with Options');
  });

  test('handles DocumentApp setHeading failure with fallback to bold', () => {
    const msg = createMessage({
      subject: 'Test Heading Fallback',
      body: 'Testing fallback',
      date: new Date('2024-01-01T10:00:00Z')
    });
    
    // Mock DocumentApp with setHeading that throws
    const mockDocumentApp = {
      ParagraphHeading: { HEADING_3: 'HEADING_3' },
      Attribute: { BOLD: 'BOLD' }
    };
    
    // Override insertParagraph to return para with setHeading that throws
    const originalInsertParagraph = body.insertParagraph;
    body.insertParagraph = function(index, text) {
      const para = originalInsertParagraph.call(this, index, text);
      para.setHeading = function() {
        throw new Error('Document busy');
      };
      return para;
    };
    
    const options = { DocumentApp: mockDocumentApp };
    
    processMessageToDoc(msg, body, folder, options);
    
    // Restore original
    body.insertParagraph = originalInsertParagraph;
    
    // Verify message was still added despite error
    const paragraphs = body.getParagraphs();
    expect(paragraphs[0].getText()).toBe('Subject: Test Heading Fallback');
  });

  test('handles Utilities.sleep when provided', () => {
    const msg = createMessage({
      subject: 'Test with Utilities',
      body: 'Testing Utilities.sleep',
      date: new Date('2024-01-01T10:00:00Z')
    });
    
    const mockUtilities = {
      sleep: jest.fn()
    };
    
    const options = {
      Utilities: mockUtilities
    };
    
    processMessageToDoc(msg, body, folder, options);
    
    // Verify Utilities.sleep was called
    expect(mockUtilities.sleep).toHaveBeenCalledWith(500);
  });

  test('handles duplicate detection with Logger option', () => {
    // Pre-create a file
    const existingBlob = createBlob('duplicate content', 'dup.txt');
    folder.createFile(existingBlob);
    
    // Create message with duplicate attachment
    const duplicateAttachment = createBlob('duplicate content', 'dup.txt');
    const msg = createMessage({
      subject: 'Email with Duplicate and Logger',
      body: 'Test Logger on duplicate',
      date: new Date('2024-01-01T10:00:00Z'),
      attachments: [duplicateAttachment]
    });
    
    const mockLogger = {
      log: jest.fn()
    };
    
    const options = {
      Logger: mockLogger
    };
    
    global.GmailApp.__addThreadWithLabels(['test-trigger'], [msg]);
    const threads = global.GmailApp.getUserLabelByName('test-trigger').getThreads();
    const messages = threads[0].getMessages();
    
    processMessagesToDoc(messages, body, folder, options);
    
    // Verify Logger.log was called for duplicate
    expect(mockLogger.log).toHaveBeenCalledWith(expect.stringContaining('duplicate'));
    
    // Verify duplicate was skipped
    const paragraphs = body.getParagraphs();
    expect(paragraphs.some(p => p.getText().includes('[DUPLICATE SKIPPED]'))).toBe(true);
  });

  test('handles name conflict with Utilities and Session options', () => {
    // Pre-create a file with same name but different content
    const existingBlob = createBlob('original content', 'conflict.txt');
    folder.createFile(existingBlob);
    
    // Create message with attachment that has same name but different content
    const newAttachment = createBlob('new different content', 'conflict.txt');
    const msg = createMessage({
      subject: 'Email with Name Conflict and Utilities',
      body: 'Test Utilities.formatDate',
      date: new Date('2024-01-01T10:00:00Z'),
      attachments: [newAttachment]
    });
    
    const mockUtilities = {
      formatDate: jest.fn().mockReturnValue('_123456'),
      sleep: jest.fn()
    };
    
    const mockSession = {
      getScriptTimeZone: jest.fn().mockReturnValue('America/New_York')
    };
    
    const options = {
      Utilities: mockUtilities,
      Session: mockSession
    };
    
    global.GmailApp.__addThreadWithLabels(['test-trigger'], [msg]);
    const threads = global.GmailApp.getUserLabelByName('test-trigger').getThreads();
    const messages = threads[0].getMessages();
    
    processMessagesToDoc(messages, body, folder, options);
    
    // Verify Utilities.formatDate was called
    expect(mockUtilities.formatDate).toHaveBeenCalled();
    expect(mockSession.getScriptTimeZone).toHaveBeenCalled();
    
    // Should have 2 files (original and renamed new one)
    const files = folder.__getFiles();
    expect(files.length).toBe(2);
    
    // Verify one file has timestamp in name
    const fileNames = files.map(f => f.getName());
    expect(fileNames).toContain('conflict.txt');
    expect(fileNames.some(name => name.includes('_123456'))).toBe(true);
  });
});
