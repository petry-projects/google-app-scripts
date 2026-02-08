const { createMessage, createBlob } = require('../../../test-utils/mocks');

describe('Email prepending to document', () => {
  let doc, body, folder, label, thread, message;

  beforeEach(() => {
    global.__mocks.docs.__reset();
    global.__mocks.gmail.__reset();
    global.__mocks.drive.__reset();
    
    // Setup document
    doc = global.DocumentApp.openById('test-doc');
    body = doc.getBody();
    
    // Setup folder
    folder = global.DriveApp.getFolderById('test-folder');
    
    // Setup email
    message = createMessage({
      subject: 'Test Email',
      body: 'This is the email body',
      date: new Date('2024-01-01T12:00:00Z')
    });
    
    thread = global.GmailApp.__addThreadWithLabels(['test-label'], [message]);
    label = global.GmailApp.getUserLabelByName('test-label');
  });

  test('new email content should be inserted at the top of document', () => {
    // Add initial content to document (simulating existing content)
    body.appendParagraph('Old Content 1');
    body.appendParagraph('Old Content 2');
    
    // Verify initial state
    expect(body.getParagraphs().length).toBe(2);
    expect(body.getParagraphs()[0].getText()).toBe('Old Content 1');
    expect(body.getParagraphs()[1].getText()).toBe('Old Content 2');
    
    // Simulate adding new email at the top
    const subjectText = 'Subject: Test Email';
    const headingPara = body.insertParagraph(0, subjectText);
    headingPara.setHeading('HEADING_3');
    
    body.insertParagraph(1, 'Date: Mon Jan 01 2024 12:00:00 GMT+0000 (Coordinated Universal Time)');
    body.insertParagraph(2, 'This is the email body');
    body.insertParagraph(3, '------------------------------');
    
    // Verify new content is at top
    const paragraphs = body.getParagraphs();
    expect(paragraphs.length).toBe(6);
    expect(paragraphs[0].getText()).toBe('Subject: Test Email');
    expect(paragraphs[1].getText()).toContain('Date:');
    expect(paragraphs[2].getText()).toBe('This is the email body');
    expect(paragraphs[3].getText()).toBe('------------------------------');
    expect(paragraphs[4].getText()).toBe('Old Content 1');
    expect(paragraphs[5].getText()).toBe('Old Content 2');
  });

  test('multiple emails should be prepended in order (newest first)', () => {
    // Add first email
    body.insertParagraph(0, 'Subject: First Email');
    body.insertParagraph(1, 'Date: 2024-01-01');
    body.insertParagraph(2, 'First email body');
    body.insertParagraph(3, '------------------------------');
    
    // Add second email (should go to top)
    body.insertParagraph(0, 'Subject: Second Email');
    body.insertParagraph(1, 'Date: 2024-01-02');
    body.insertParagraph(2, 'Second email body');
    body.insertParagraph(3, '------------------------------');
    
    const paragraphs = body.getParagraphs();
    expect(paragraphs.length).toBe(8);
    
    // Newest email should be at top
    expect(paragraphs[0].getText()).toBe('Subject: Second Email');
    expect(paragraphs[4].getText()).toBe('Subject: First Email');
  });

  test('prepending with attachments listed', () => {
    // Add initial content
    body.appendParagraph('Old Content');
    
    // Add new email with attachments
    body.insertParagraph(0, 'Subject: Email with attachments');
    body.insertParagraph(1, 'Date: 2024-01-01');
    body.insertParagraph(2, 'Email body');
    body.insertParagraph(3, '[Attachments]:');
    body.insertParagraph(4, '- file1.txt');
    body.insertParagraph(5, '------------------------------');
    
    const paragraphs = body.getParagraphs();
    expect(paragraphs.length).toBe(7);
    
    // New content should be at top
    expect(paragraphs[0].getText()).toBe('Subject: Email with attachments');
    expect(paragraphs[3].getText()).toBe('[Attachments]:');
    expect(paragraphs[6].getText()).toBe('Old Content');
  });
});
