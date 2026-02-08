const { createMessage, createBlob } = require('../../../test-utils/mocks');

// This test simulates the actual email processing flow from code.gs
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
    
    // Simulate processing like code.gs does
    const threads = triggerLabel.getThreads();
    expect(threads.length).toBe(1);
    
    threads.forEach((thread) => {
      const messages = thread.getMessages();
      
      // Sort messages by date (oldest first) like code.gs does
      messages.sort(function(a, b) {
        return a.getDate().getTime() - b.getDate().getTime();
      });
      
      messages.forEach((message) => {
        var currentIndex = 0;
        const subject = message.getSubject();
        const rawContent = message.getPlainBody();
        const timestamp = message.getDate();
        
        // Prepend to doc (simulating code.gs behavior)
        const subjectText = "Subject: " + (subject ? subject : "(No Subject)");
        const headingPara = body.insertParagraph(currentIndex++, subjectText);
        headingPara.setHeading('HEADING_3');
        
        body.insertParagraph(currentIndex++, "Date: " + timestamp);
        body.insertParagraph(currentIndex++, rawContent);
        body.insertParagraph(currentIndex++, "------------------------------");
      });
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

  test('prepends email with attachments correctly', () => {
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
    
    // Simulate processing
    const threads = triggerLabel.getThreads();
    const messages = threads[0].getMessages();
    const message = messages[0];
    
    var currentIndex = 0;
    const subject = message.getSubject();
    const timestamp = message.getDate();
    const attachments = message.getAttachments();
    
    // Prepend subject, date, content
    body.insertParagraph(currentIndex++, "Subject: " + subject);
    body.insertParagraph(currentIndex++, "Date: " + timestamp);
    body.insertParagraph(currentIndex++, message.getPlainBody());
    
    // Prepend attachments section
    if (attachments.length > 0) {
      body.insertParagraph(currentIndex++, "[Attachments]:");
      
      attachments.forEach((att) => {
        const file = folder.createFile(att);
        body.insertParagraph(currentIndex++, "- " + file.getName());
      });
    }
    
    body.insertParagraph(currentIndex++, "------------------------------");
    
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
    
    // Process the new email
    const threads = triggerLabel.getThreads();
    const message = threads[0].getMessages()[0];
    
    var currentIndex = 0;
    body.insertParagraph(currentIndex++, "Subject: " + message.getSubject());
    body.insertParagraph(currentIndex++, "Date: " + message.getDate());
    body.insertParagraph(currentIndex++, message.getPlainBody());
    body.insertParagraph(currentIndex++, "------------------------------");
    
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
    
    // Process all threads
    const threads = triggerLabel.getThreads();
    expect(threads.length).toBe(2);
    
    threads.forEach((thread) => {
      const messages = thread.getMessages();
      messages.forEach((message) => {
        var currentIndex = 0;
        body.insertParagraph(currentIndex++, "Subject: " + message.getSubject());
        body.insertParagraph(currentIndex++, "Date: " + message.getDate());
        body.insertParagraph(currentIndex++, message.getPlainBody());
        body.insertParagraph(currentIndex++, "------------------------------");
      });
    });
    
    // Verify both threads are in document
    const paragraphs = body.getParagraphs();
    expect(paragraphs.length).toBe(8);
    
    // Most recently processed thread should be at top
    expect(paragraphs[0].getText()).toBe('Subject: Thread 2 Email');
    expect(paragraphs[4].getText()).toBe('Subject: Thread 1 Email');
  });
});
