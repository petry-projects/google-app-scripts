const { createMessage } = require('../../../test-utils/mocks');
const { sortThreadsByLastMessageDate } = require('../src/index');

describe('Thread ordering for prepending', () => {
  let doc, body, folder;

  beforeEach(() => {
    global.__mocks.docs.__reset();
    global.__mocks.gmail.__reset();
    global.__mocks.drive.__reset();
    
    // Setup document
    doc = global.DocumentApp.openById('test-doc');
    body = doc.getBody();
    
    // Setup folder
    folder = global.DriveApp.getFolderById('test-folder');
  });

  test('threads should be sorted in reverse chronological order (newest first)', () => {
    // Create three threads with different dates
    const oldThread = global.GmailApp.__addThreadWithLabels(['test-label'], [
      createMessage({
        subject: 'Old Thread',
        body: 'This is from 2024-01-01',
        date: new Date('2024-01-01T10:00:00Z')
      })
    ]);
    
    const middleThread = global.GmailApp.__addThreadWithLabels(['test-label'], [
      createMessage({
        subject: 'Middle Thread',
        body: 'This is from 2024-01-15',
        date: new Date('2024-01-15T10:00:00Z')
      })
    ]);
    
    const newestThread = global.GmailApp.__addThreadWithLabels(['test-label'], [
      createMessage({
        subject: 'Newest Thread',
        body: 'This is from 2024-02-01',
        date: new Date('2024-02-01T10:00:00Z')
      })
    ]);
    
    // Get threads (they may be in any order from Gmail API)
    const label = global.GmailApp.getUserLabelByName('test-label');
    const threads = label.getThreads();
    
    // Sort threads using the helper function
    const sortedThreads = sortThreadsByLastMessageDate(threads);
    
    // Verify order: newest thread should be first
    expect(sortedThreads[0].getMessages()[0].getSubject()).toBe('Newest Thread');
    expect(sortedThreads[1].getMessages()[0].getSubject()).toBe('Middle Thread');
    expect(sortedThreads[2].getMessages()[0].getSubject()).toBe('Old Thread');
  });

  test('threads with multiple messages should use last message date for sorting', () => {
    // Thread 1: Started old but has recent messages
    global.GmailApp.__addThreadWithLabels(['test-label'], [
      createMessage({
        subject: 'Thread with recent reply',
        body: 'Initial message',
        date: new Date('2024-01-01T10:00:00Z')
      }),
      createMessage({
        subject: 'Re: Thread with recent reply',
        body: 'Recent reply',
        date: new Date('2024-02-15T10:00:00Z') // Most recent
      })
    ]);
    
    // Thread 2: Single message from mid-January
    const thread2 = global.GmailApp.__addThreadWithLabels(['test-label'], [
      createMessage({
        subject: 'Single message thread',
        body: 'This is from mid-January',
        date: new Date('2024-01-15T10:00:00Z')
      })
    ]);
    
    // Get and sort threads
    const label = global.GmailApp.getUserLabelByName('test-label');
    const threads = label.getThreads();
    const sortedThreads = sortThreadsByLastMessageDate(threads);
    
    // Thread1 has most recent message (2024-02-15), so it should be first
    // Even though it started earlier
    const firstThreadMessages = sortedThreads[0].getMessages();
    expect(firstThreadMessages[0].getSubject()).toBe('Thread with recent reply');
    
    const secondThreadMessages = sortedThreads[1].getMessages();
    expect(secondThreadMessages[0].getSubject()).toBe('Single message thread');
  });

  test('sorting should not modify original threads array', () => {
    // Create threads
    global.GmailApp.__addThreadWithLabels(['test-label'], [
      createMessage({ subject: 'Old', date: new Date('2024-01-01') })
    ]);
    global.GmailApp.__addThreadWithLabels(['test-label'], [
      createMessage({ subject: 'New', date: new Date('2024-02-01') })
    ]);
    
    const label = global.GmailApp.getUserLabelByName('test-label');
    const threads = label.getThreads();
    const originalOrder = threads.map(t => t.getMessages()[0].getSubject());
    
    // Sort threads
    const sortedThreads = sortThreadsByLastMessageDate(threads);
    
    // Original array should be unchanged
    const afterSortOrder = threads.map(t => t.getMessages()[0].getSubject());
    expect(afterSortOrder).toEqual(originalOrder);
    
    // Sorted array should be in reverse chronological order
    expect(sortedThreads[0].getMessages()[0].getSubject()).toBe('New');
    expect(sortedThreads[1].getMessages()[0].getSubject()).toBe('Old');
  });
});
