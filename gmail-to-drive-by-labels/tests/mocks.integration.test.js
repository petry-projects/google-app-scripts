const { createMessage, createBlob } = require('../../test-utils/mocks');

describe('Apps Script mocks integration', () => {
  test('GmailApp createLabel and thread handling', () => {
    const label = global.GmailApp.createLabel('TEST');
    const msg = createMessage({ subject: 'Hi', body: 'Hello' });
    const thread = global.GmailApp.__addThreadWithLabels(['TEST'], [msg]);

    const found = global.GmailApp.getUserLabelByName('TEST');
    expect(found).not.toBeNull();
    const threads = found.getThreads();
    expect(threads.length).toBe(1);
    expect(threads[0].getMessages()[0].getSubject()).toBe('Hi');
  });

  test('DocumentApp appendParagraph and DriveApp deduplication helpers', () => {
    const doc = global.DocumentApp.openById('doc-1');
    const body = doc.getBody();
    body.appendParagraph('Hello');
    expect(body.getParagraphs().length).toBe(1);

    const folder = global.DriveApp.getFolderById('f-1');
    const b1 = createBlob('a', 'foo.txt');
    const b2 = createBlob('a', 'foo.txt');
    const f1 = folder.createFile(b1);
    // files with same content should be separate objects but can be compared by getBlob
    const existing = folder.getFilesByName('foo.txt');
    expect(existing.hasNext()).toBe(true);
    const file = existing.next();
    expect(file.getBlob().getBytes().toString()).toBe(Buffer.from('a').toString());
  });
});
