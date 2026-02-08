const { createMessage } = require('../../../test-utils/mocks');
const { processMessagesToDoc } = require('../src/index');

describe('Thread deduplication when new messages arrive', () => {
  let doc, body, folder;

  beforeEach(() => {
    global.__mocks.docs.__reset();
    global.__mocks.gmail.__reset();
    global.__mocks.drive.__reset();
    
    doc = global.DocumentApp.openById('test-doc');
    body = doc.getBody();
    folder = global.DriveApp.getFolderById('test-folder');
  });

  test('thread ID should be included in separator', () => {
    const messages = [
      createMessage({
        subject: 'Test Email',
        body: 'Email content',
        date: new Date('2024-01-01T10:00:00Z')
      })
    ];
    
    // Create a thread with an ID
    const thread = global.GmailApp.__addThreadWithLabels(['test-label'], messages);
    
    // Process the thread
    processMessagesToDoc(messages, body, folder, { threadId: thread.getId() });
    
    // Check that separator includes thread ID
    const paragraphs = body.getParagraphs();
    const separator = paragraphs[3].getText();
    expect(separator).toContain('------------------------------');
    expect(separator).toContain('[THREAD:');
    expect(separator).toContain(thread.getId());
  });

  test('when thread already exists in doc, old content should be removed before inserting new', () => {
    // Create a thread
    const threadMessages = [
      createMessage({
        subject: 'Original Thread',
        body: 'Original message',
        date: new Date('2024-01-01T10:00:00Z')
      })
    ];
    const thread = global.GmailApp.__addThreadWithLabels(['test-label'], threadMessages);
    const threadId = thread.getId();
    
    // First insertion - process original thread
    processMessagesToDoc(threadMessages, body, folder, { threadId });
    
    // Verify initial state
    let paragraphs = body.getParagraphs();
    expect(paragraphs.length).toBe(4); // subject, date, content, separator
    expect(paragraphs[0].getText()).toBe('Subject: Original Thread');
    expect(paragraphs[2].getText()).toBe('Original message');
    
    // Simulate new message arriving on same thread
    const updatedMessages = [
      createMessage({
        subject: 'Original Thread',
        body: 'Original message',
        date: new Date('2024-01-01T10:00:00Z')
      }),
      createMessage({
        subject: 'Re: Original Thread',
        body: 'New reply message',
        date: new Date('2024-01-02T10:00:00Z')
      })
    ];
    
    // Second insertion - process updated thread with new message
    // This should remove the old thread content first
    processMessagesToDoc(updatedMessages, body, folder, { threadId });
    
    // Verify: should have 8 paragraphs (2 messages × 4 paragraphs each)
    // and NOT 12 paragraphs (old + new)
    paragraphs = body.getParagraphs();
    expect(paragraphs.length).toBe(8);
    
    // Most recent message should be at top
    expect(paragraphs[0].getText()).toBe('Subject: Re: Original Thread');
    expect(paragraphs[2].getText()).toBe('New reply message');
    
    // Original message should be below
    expect(paragraphs[4].getText()).toBe('Subject: Original Thread');
    expect(paragraphs[6].getText()).toBe('Original message');
    
    // Should have one separator with thread ID
    const separatorText = paragraphs[7].getText();
    expect(separatorText).toContain('[THREAD:');
    expect(separatorText).toContain(threadId);
  });

  test('multiple different threads should coexist in document', () => {
    // Thread 1
    const thread1Messages = [
      createMessage({
        subject: 'Thread 1',
        body: 'Content 1',
        date: new Date('2024-01-01T10:00:00Z')
      })
    ];
    const thread1 = global.GmailApp.__addThreadWithLabels(['test-label'], thread1Messages);
    
    // Thread 2
    const thread2Messages = [
      createMessage({
        subject: 'Thread 2',
        body: 'Content 2',
        date: new Date('2024-01-02T10:00:00Z')
      })
    ];
    const thread2 = global.GmailApp.__addThreadWithLabels(['test-label'], thread2Messages);
    
    // Process both threads
    processMessagesToDoc(thread1Messages, body, folder, { threadId: thread1.getId() });
    processMessagesToDoc(thread2Messages, body, folder, { threadId: thread2.getId() });
    
    // Should have 8 paragraphs (2 threads × 4 paragraphs each)
    const paragraphs = body.getParagraphs();
    expect(paragraphs.length).toBe(8);
    
    // Thread 2 should be at top (processed later)
    expect(paragraphs[0].getText()).toBe('Subject: Thread 2');
    
    // Thread 1 should be below
    expect(paragraphs[4].getText()).toBe('Subject: Thread 1');
    
    // Each should have its own separator with unique thread ID
    expect(paragraphs[3].getText()).toContain(thread2.getId());
    expect(paragraphs[7].getText()).toContain(thread1.getId());
  });

  test('updating one thread should not affect other threads', () => {
    // Create two threads
    const thread1Messages = [
      createMessage({
        subject: 'Thread 1',
        body: 'Content 1',
        date: new Date('2024-01-01T10:00:00Z')
      })
    ];
    const thread1 = global.GmailApp.__addThreadWithLabels(['test-label'], thread1Messages);
    
    const thread2Messages = [
      createMessage({
        subject: 'Thread 2',
        body: 'Content 2',
        date: new Date('2024-01-02T10:00:00Z')
      })
    ];
    const thread2 = global.GmailApp.__addThreadWithLabels(['test-label'], thread2Messages);
    
    // Process both
    processMessagesToDoc(thread1Messages, body, folder, { threadId: thread1.getId() });
    processMessagesToDoc(thread2Messages, body, folder, { threadId: thread2.getId() });
    
    // Update thread1 with new message
    const updatedThread1Messages = [
      ...thread1Messages,
      createMessage({
        subject: 'Re: Thread 1',
        body: 'Reply to thread 1',
        date: new Date('2024-01-03T10:00:00Z')
      })
    ];
    
    processMessagesToDoc(updatedThread1Messages, body, folder, { threadId: thread1.getId() });
    
    // Should have 12 paragraphs: thread1 (8 paras for 2 messages) + thread2 (4 paras)
    const paragraphs = body.getParagraphs();
    expect(paragraphs.length).toBe(12);
    
    // Updated thread1 should be at top
    expect(paragraphs[0].getText()).toBe('Subject: Re: Thread 1');
    
    // Thread2 should still exist and be unchanged
    expect(paragraphs[8].getText()).toBe('Subject: Thread 2');
    expect(paragraphs[10].getText()).toBe('Content 2');
  });
});
