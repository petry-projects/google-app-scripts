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
    const separators = paragraphs.filter(p => p.getText().includes('------------------------------'));
    expect(separators.length).toBeGreaterThan(0);
    const threadSeparator = separators.find(s => s.getText().includes('[THREAD:'));
    expect(threadSeparator).toBeDefined();
    expect(threadSeparator.getText()).toContain('[THREAD:');
    expect(threadSeparator.getText()).toContain(thread.getId());
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
    
    // Verify initial state - should have subject, date, content, and separator
    let paragraphs = body.getParagraphs();
    const initialCount = paragraphs.length;
    expect(paragraphs.some(p => p.getText().includes('Subject: Original Thread'))).toBe(true);
    expect(paragraphs.some(p => p.getText().includes('Original message'))).toBe(true);
    expect(paragraphs.some(p => p.getText().includes(`[THREAD:${threadId}]`))).toBe(true);
    
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
    
    // Verify: should have exactly 2x the paragraphs of a single message (2 messages)
    // and NOT 3x (which would mean old thread wasn't removed)
    paragraphs = body.getParagraphs();
    expect(paragraphs.length).toBe(initialCount * 2);
    
    // Most recent message should be at top
    expect(paragraphs.some(p => p.getText().includes('Subject: Re: Original Thread'))).toBe(true);
    expect(paragraphs.some(p => p.getText().includes('New reply message'))).toBe(true);
    
    // Original message should also be present
    expect(paragraphs.some(p => p.getText().includes('Subject: Original Thread'))).toBe(true);
    expect(paragraphs.some(p => p.getText().includes('Original message'))).toBe(true);
    
    // Should have exactly one separator with thread ID
    const threadSeparators = paragraphs.filter(p => p.getText().includes(`[THREAD:${threadId}]`));
    expect(threadSeparators.length).toBe(1);
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
    const singleThreadCount = body.getParagraphs().length;
    
    processMessagesToDoc(thread2Messages, body, folder, { threadId: thread2.getId() });
    
    // Should have exactly 2x the paragraphs of a single thread
    const paragraphs = body.getParagraphs();
    expect(paragraphs.length).toBe(singleThreadCount * 2);
    
    // Both threads should be present
    expect(paragraphs.some(p => p.getText().includes('Subject: Thread 1'))).toBe(true);
    expect(paragraphs.some(p => p.getText().includes('Subject: Thread 2'))).toBe(true);
    
    // Each should have its own separator with unique thread ID
    const thread1Separators = paragraphs.filter(p => p.getText().includes(`[THREAD:${thread1.getId()}]`));
    const thread2Separators = paragraphs.filter(p => p.getText().includes(`[THREAD:${thread2.getId()}]`));
    expect(thread1Separators.length).toBe(1);
    expect(thread2Separators.length).toBe(1);
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
    const singleThreadCount = body.getParagraphs().length;
    
    processMessagesToDoc(thread2Messages, body, folder, { threadId: thread2.getId() });
    const twoThreadsCount = body.getParagraphs().length;
    
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
    
    // Should have: updated thread1 (2 messages) + thread2 (1 message)
    // = 2 * singleThreadCount + singleThreadCount = 3 * singleThreadCount
    const paragraphs = body.getParagraphs();
    expect(paragraphs.length).toBe(singleThreadCount * 3);
    
    // Updated thread1 content should be present
    expect(paragraphs.some(p => p.getText().includes('Subject: Re: Thread 1'))).toBe(true);
    expect(paragraphs.some(p => p.getText().includes('Reply to thread 1'))).toBe(true);
    
    // Thread2 should still exist and be unchanged
    expect(paragraphs.some(p => p.getText().includes('Subject: Thread 2'))).toBe(true);
    expect(paragraphs.some(p => p.getText().includes('Content 2'))).toBe(true);
    
    // Both threads should have their separators
    const thread1Separators = paragraphs.filter(p => p.getText().includes(`[THREAD:${thread1.getId()}]`));
    const thread2Separators = paragraphs.filter(p => p.getText().includes(`[THREAD:${thread2.getId()}]`));
    expect(thread1Separators.length).toBe(1);
    expect(thread2Separators.length).toBe(1);
  });
});
