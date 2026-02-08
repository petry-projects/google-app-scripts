const { createMessage } = require('../../../test-utils/mocks');

// Mock the config
global.getProcessConfig = jest.fn(() => [
  {
    triggerLabel: 'test-label',
    processedLabel: 'test-label-archived',
    docId: 'doc-1',
    folderId: 'folder-1'
  }
]);

// Load the code after mocks are set up
const { rebuildDoc, rebuildAllDocs } = require('../code.gs');

describe('rebuildDoc', () => {
  beforeEach(() => {
    global.GmailApp.__reset();
    global.DocumentApp.__reset();
    global.DriveApp.__reset();
    global.PropertiesService.__reset();
    jest.clearAllMocks();
  });

  test('clears document and moves emails from processed to trigger label', () => {
    // Setup: Create labels
    const triggerLabel = global.GmailApp.createLabel('test-label');
    const processedLabel = global.GmailApp.createLabel('test-label-archived');

    // Setup: Add some processed threads
    const msg1 = createMessage({ subject: 'Email 1', body: 'Body 1' });
    const msg2 = createMessage({ subject: 'Email 2', body: 'Body 2' });
    global.GmailApp.__addThreadWithLabels(['test-label-archived'], [msg1]);
    global.GmailApp.__addThreadWithLabels(['test-label-archived'], [msg2]);

    // Setup: Create document with content
    const doc = global.DocumentApp.openById('doc-1');
    const body = doc.getBody();
    body.appendParagraph('Old content 1');
    body.appendParagraph('Old content 2');
    body.appendParagraph('Old content 3');

    // Verify initial state
    expect(body.getParagraphs().length).toBe(3);
    expect(processedLabel.getThreads().length).toBe(2);
    expect(triggerLabel.getThreads().length).toBe(0);

    // Run rebuild
    const config = {
      triggerLabel: 'test-label',
      processedLabel: 'test-label-archived',
      docId: 'doc-1',
      folderId: 'folder-1'
    };
    const completed = rebuildDoc(config);

    // Verify document is cleared
    expect(body.getParagraphs().length).toBe(0);

    // Verify emails are moved back to trigger label
    expect(triggerLabel.getThreads().length).toBe(2);
    expect(processedLabel.getThreads().length).toBe(0);
    
    // Verify operation completed
    expect(completed).toBe(true);
  });

  test('handles missing processed label gracefully', () => {
    // Setup: Create only trigger label (no processed label)
    const triggerLabel = global.GmailApp.createLabel('test-label');

    // Setup: Create document with content
    const doc = global.DocumentApp.openById('doc-1');
    const body = doc.getBody();
    body.appendParagraph('Old content');

    // Run rebuild
    const config = {
      triggerLabel: 'test-label',
      processedLabel: 'test-label-archived',
      docId: 'doc-1',
      folderId: 'folder-1'
    };

    // Should not throw
    expect(() => rebuildDoc(config)).not.toThrow();

    // Document should still be cleared
    expect(body.getParagraphs().length).toBe(0);
  });

  test('handles missing trigger label gracefully', () => {
    // Setup: Create document
    const doc = global.DocumentApp.openById('doc-1');
    const body = doc.getBody();
    body.appendParagraph('Old content');

    // Run rebuild with non-existent trigger label
    const config = {
      triggerLabel: 'non-existent-label',
      processedLabel: 'test-label-archived',
      docId: 'doc-1',
      folderId: 'folder-1'
    };

    // Should not throw
    expect(() => rebuildDoc(config)).not.toThrow();

    // Document should not be cleared (function returns early)
    expect(body.getParagraphs().length).toBe(1);
  });

  test('clears empty document without errors', () => {
    // Setup: Create labels
    global.GmailApp.createLabel('test-label');

    // Setup: Create empty document
    const doc = global.DocumentApp.openById('doc-1');
    const body = doc.getBody();

    // Verify initial state
    expect(body.getParagraphs().length).toBe(0);

    // Run rebuild
    const config = {
      triggerLabel: 'test-label',
      processedLabel: 'test-label-archived',
      docId: 'doc-1',
      folderId: 'folder-1'
    };

    // Should not throw
    expect(() => rebuildDoc(config)).not.toThrow();

    // Document should still be empty
    expect(body.getParagraphs().length).toBe(0);
  });

  test('moves multiple threads correctly', () => {
    // Setup: Create labels
    const triggerLabel = global.GmailApp.createLabel('test-label');
    const processedLabel = global.GmailApp.createLabel('test-label-archived');

    // Setup: Add many processed threads
    const threads = [];
    for (let i = 0; i < 25; i++) {
      const msg = createMessage({ subject: `Email ${i}`, body: `Body ${i}` });
      const thread = global.GmailApp.__addThreadWithLabels(['test-label-archived'], [msg]);
      threads.push(thread);
    }

    // Setup: Create document
    const doc = global.DocumentApp.openById('doc-1');
    const body = doc.getBody();
    body.appendParagraph('Content');

    // Verify initial state
    expect(processedLabel.getThreads().length).toBe(25);
    expect(triggerLabel.getThreads().length).toBe(0);

    // Run rebuild
    const config = {
      triggerLabel: 'test-label',
      processedLabel: 'test-label-archived',
      docId: 'doc-1',
      folderId: 'folder-1'
    };
    rebuildDoc(config);

    // Verify all threads are moved
    expect(triggerLabel.getThreads().length).toBe(25);
    expect(processedLabel.getThreads().length).toBe(0);
  });

  test('handles document opening errors gracefully', () => {
    // Setup: Create labels
    global.GmailApp.createLabel('test-label');
    const processedLabel = global.GmailApp.createLabel('test-label-archived');

    // Setup: Add a processed thread
    const msg = createMessage({ subject: 'Email 1', body: 'Body 1' });
    global.GmailApp.__addThreadWithLabels(['test-label-archived'], [msg]);

    // Mock DocumentApp.openById to throw an error
    const originalOpenById = global.DocumentApp.openById;
    global.DocumentApp.openById = jest.fn(() => {
      throw new Error('Document not found');
    });

    // Run rebuild
    const config = {
      triggerLabel: 'test-label',
      processedLabel: 'test-label-archived',
      docId: 'invalid-doc-id',
      folderId: 'folder-1'
    };

    // Should not throw and should return early
    expect(() => rebuildDoc(config)).not.toThrow();

    // Verify emails were NOT moved (function returned early)
    expect(processedLabel.getThreads().length).toBe(1);

    // Restore original function
    global.DocumentApp.openById = originalOpenById;
  });

  test('handles document setText errors gracefully', () => {
    // Setup: Create labels
    global.GmailApp.createLabel('test-label');
    const processedLabel = global.GmailApp.createLabel('test-label-archived');

    // Setup: Add a processed thread
    const msg = createMessage({ subject: 'Email 1', body: 'Body 1' });
    global.GmailApp.__addThreadWithLabels(['test-label-archived'], [msg]);

    // Setup: Create a mock document that throws on setText
    const mockDoc = {
      getBody: () => ({
        setText: jest.fn(() => {
          throw new Error('Permission denied');
        })
      })
    };

    // Mock DocumentApp.openById to return our mock document
    const originalOpenById = global.DocumentApp.openById;
    global.DocumentApp.openById = jest.fn(() => mockDoc);

    // Run rebuild
    const config = {
      triggerLabel: 'test-label',
      processedLabel: 'test-label-archived',
      docId: 'doc-1',
      folderId: 'folder-1'
    };

    // Should not throw and should return early
    expect(() => rebuildDoc(config)).not.toThrow();

    // Verify emails were NOT moved (function returned early)
    expect(processedLabel.getThreads().length).toBe(1);

    // Restore original function
    global.DocumentApp.openById = originalOpenById;
  });

  test('handles resumable batching for large label sets', () => {
    // Setup: Create labels
    const triggerLabel = global.GmailApp.createLabel('test-label');
    const processedLabel = global.GmailApp.createLabel('test-label-archived');

    // Setup: Add many processed threads (more than batch size of 100)
    for (let i = 0; i < 150; i++) {
      const msg = createMessage({ subject: `Email ${i}`, body: `Body ${i}` });
      global.GmailApp.__addThreadWithLabels(['test-label-archived'], [msg]);
    }

    // Setup: Create document
    const doc = global.DocumentApp.openById('doc-1');
    doc.getBody().appendParagraph('Content');

    // Verify initial state
    expect(processedLabel.getThreads().length).toBe(150);
    expect(triggerLabel.getThreads().length).toBe(0);

    // Run rebuild - should handle batching automatically
    const config = {
      triggerLabel: 'test-label',
      processedLabel: 'test-label-archived',
      docId: 'doc-1',
      folderId: 'folder-1'
    };
    
    // First run - processes up to BATCH_SIZE (100)
    const completed1 = rebuildDoc(config);
    
    // Should not complete if there are more than BATCH_SIZE threads
    expect(completed1).toBe(false);
    
    // Document should be cleared
    expect(doc.getBody().getParagraphs().length).toBe(0);
    
    // First batch should be moved (100 threads)
    expect(triggerLabel.getThreads().length).toBe(100);
    expect(processedLabel.getThreads().length).toBe(50);
    
    // State should be saved
    const properties = global.PropertiesService.getUserProperties();
    const stateKey = 'rebuild_state_test_label';
    let savedState = properties.getProperty(stateKey);
    expect(savedState).not.toBeNull();
    let state = JSON.parse(savedState);
    expect(state.phase).toBe('move_emails');
    
    // Second run - processes remaining 50 threads
    const completed2 = rebuildDoc(config);
    
    // Should complete on second run
    expect(completed2).toBe(true);
    
    // All threads should be moved
    expect(triggerLabel.getThreads().length).toBe(150);
    expect(processedLabel.getThreads().length).toBe(0);
    
    // State should be cleaned up
    expect(properties.getProperty(stateKey)).toBeNull();
  });
});

describe('rebuildAllDocs', () => {
  beforeEach(() => {
    global.GmailApp.__reset();
    global.DocumentApp.__reset();
    global.DriveApp.__reset();
    global.PropertiesService.__reset();
    jest.clearAllMocks();
  });

  test('rebuilds all configured documents', () => {
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

    // Setup: Create labels and documents
    global.GmailApp.createLabel('label-1');
    global.GmailApp.createLabel('label-1-archived');
    global.GmailApp.createLabel('label-2');
    global.GmailApp.createLabel('label-2-archived');

    const doc1 = global.DocumentApp.openById('doc-1');
    const doc2 = global.DocumentApp.openById('doc-2');
    
    doc1.getBody().appendParagraph('Doc 1 content');
    doc2.getBody().appendParagraph('Doc 2 content');

    // Verify initial state
    expect(doc1.getBody().getParagraphs().length).toBe(1);
    expect(doc2.getBody().getParagraphs().length).toBe(1);

    // Run rebuild all
    rebuildAllDocs();

    // Verify both documents are cleared
    expect(doc1.getBody().getParagraphs().length).toBe(0);
    expect(doc2.getBody().getParagraphs().length).toBe(0);
  });

  test('handles single configuration', () => {
    // Setup single config (default mock)
    global.getProcessConfig.mockReturnValue([
      {
        triggerLabel: 'test-label',
        processedLabel: 'test-label-archived',
        docId: 'doc-1',
        folderId: 'folder-1'
      }
    ]);

    // Setup: Create label and document
    global.GmailApp.createLabel('test-label');
    const doc = global.DocumentApp.openById('doc-1');
    doc.getBody().appendParagraph('Content');

    // Run rebuild all
    expect(() => rebuildAllDocs()).not.toThrow();

    // Verify document is cleared
    expect(doc.getBody().getParagraphs().length).toBe(0);
  });
});
