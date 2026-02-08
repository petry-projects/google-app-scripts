const { createMessage } = require('./test-utils/mocks');
const { processMessagesToDoc } = require('./src/gmail-to-drive-by-labels/src/index');
require('./test-utils/setup');

const doc = global.DocumentApp.openById('test-doc');
const body = doc.getBody();
const folder = global.DriveApp.getFolderById('test-folder');

const messages = [
  createMessage({
    subject: 'Test Email',
    body: 'Email content',
    date: new Date('2024-01-01T10:00:00Z')
  })
];

const thread = global.GmailApp.__addThreadWithLabels(['test-label'], messages);

// Process the thread
processMessagesToDoc(messages, body, folder, { threadId: thread.getId() });

// Check structure
const paragraphs = body.getParagraphs();
console.log('\nDocument structure:');
paragraphs.forEach((p, i) => {
  console.log(`${i}: "${p.getText()}"`);
});
