// Minimal, opinionated mocks for Google Apps Script services used in tests

const makeIterator = (arr) => {
  let i = 0;
  return {
    hasNext: () => i < arr.length,
    next: () => arr[i++]
  };
};

function createLabel(name) {
  const threads = [];
  return {
    getName: () => name,
    getThreads: () => threads.slice(),
    addThread: (thread) => { if (!threads.includes(thread)) threads.push(thread); },
    removeFromThread: (thread) => {
      const idx = threads.indexOf(thread);
      if (idx !== -1) threads.splice(idx, 1);
    }
  };
}

function createThread(messages) {
  return {
    getMessages: () => messages.slice(),
    addLabel: (label) => label.addThread(this),
    // The real API uses Label methods to add/remove; we keep simple
  };
}

function createMessage({subject = '', body = '', date = new Date(), attachments = []} = {}) {
  return {
    getSubject: () => subject,
    getPlainBody: () => body,
    getDate: () => date,
    getAttachments: () => attachments.slice()
  };
}

function createBlob(bytesOrBuffer, name = 'file.bin') {
  const buf = Buffer.isBuffer(bytesOrBuffer) ? bytesOrBuffer : Buffer.from(bytesOrBuffer || '');
  return {
    getBytes: () => buf,
    getName: () => name,
    setName: function(newName) { name = newName; },
    asBuffer: () => buf
  };
}

function createDriveFolder(id = 'root') {
  const files = [];
  return {
    id,
    getFilesByName: (name) => makeIterator(files.filter(f => f.getName() === name)),
    createFile: (blob) => {
      const file = createFile(blob.getName ? blob.getName() : 'file', blob);
      files.push(file);
      return file;
    },
    // helper for tests
    __getFiles: () => files
  };
}

function createFile(name, blob) {
  let _name = name || (blob && blob.getName && blob.getName()) || 'file';
  const bytes = blob && typeof blob.getBytes === 'function' ? blob.getBytes() : Buffer.from('');
  return {
    getName: () => _name,
    getSize: () => bytes.length,
    getBlob: () => ({ getBytes: () => bytes }),
    setName: (n) => { _name = n; },
  };
}

function createDocument(id = 'doc1') {
  const paragraphs = [];
  return {
    id,
    getBody: () => ({
      appendParagraph: (text) => {
        const para = {
          text,
          setHeading: (h) => { para.heading = h; },
          setAttributes: (s) => { para.attrs = s; },
          getText: () => para.text
        };
        paragraphs.push(para);
        return para;
      },
      getParagraphs: () => paragraphs.slice()
    })
  };
}

function createGmailApp() {
  const labels = new Map();
  return {
    __labels: labels,
    getUserLabelByName: (name) => labels.get(name) || null,
    createLabel: (name) => {
      if (labels.has(name)) return labels.get(name);
      const l = createLabel(name);
      labels.set(name, l);
      return l;
    },
    // Helpers for tests
    __addThreadWithLabels: (labelNames, messages) => {
      const thread = createThread(messages || []);
      labelNames.forEach((ln) => {
        let l = labels.get(ln);
        if (!l) { l = createLabel(ln); labels.set(ln, l); }
        l.addThread(thread);
      });
      return thread;
    },
    // Reset
    __reset: () => labels.clear()
  };
}

// Minimal Calendar and Spreadsheet mocks for tests
function createCalendarEvent({id, title='', start=new Date(), end=new Date(), description='', location='', attendees=[]} = {}) {
  return {
    getId: () => id,
    getTitle: () => title,
    getStartTime: () => start,
    getEndTime: () => end,
    getDescription: () => description,
    getLocation: () => location,
    getGuestList: () => (attendees || []).map(a => ({ getEmail: () => a }))
  };
}

function createCalendar(id='primary') {
  const events = [];
  return {
    id,
    __events: events,
    getEvents: (start, end) => events.filter(e => e.getStartTime() >= start && e.getStartTime() <= end),
    __addEvent: (evt) => { events.push(evt); },
    __reset: () => { events.length = 0 }
  };
}

function createSheet(name='Sheet1') {
  const headers = [];
  const rows = [];
  return {
    getName: () => name,
    getDataRange: () => ({ getValues: () => [headers.slice(), ...rows.map(r=>r.slice())] }),
    getLastRow: () => rows.length + (headers.length ? 1 : 0),
    appendRow: (row) => { rows.push(row.slice()); },
    getRange: (row, col, numRows, numCols) => {
      const start = row - 1 - (headers.length ? 1 : 0);
      return {
        setValues: (vals) => {
          for (let r = 0; r < vals.length; r++) {
            const dest = start + r;
            rows[dest] = rows[dest] || [];
            for (let c = 0; c < vals[r].length; c++) rows[dest][col - 1 + c] = vals[r][c];
          }
        }
      }
    },
    deleteRow: (rowIndex) => {
      const idx = rowIndex - 1 - (headers.length ? 1 : 0);
      if (idx >= 0 && idx < rows.length) rows.splice(idx,1);
    },
    __setHeader: (h) => { headers.length = 0; h.forEach(x=>headers.push(x)) },
    __getRows: () => rows
  };
}

function createSpreadsheet(id='ss1') {
  const sheets = new Map();
  // Always have a default first sheet
  const firstSheet = createSheet('Sheet1');
  sheets.set('Sheet1', firstSheet);
  
  return {
    id,
    getSheetByName: (name) => {
      if (!sheets.has(name)) {
        sheets.set(name, createSheet(name));
      }
      return sheets.get(name);
    },
    getSheets: () => [firstSheet],
    __reset: () => { 
      sheets.clear();
      sheets.set('Sheet1', firstSheet);
    }
  };
}

function createDriveApp() {
  const folders = new Map();
  return {
    __folders: folders,
    getFolderById: (id) => {
      if (!folders.has(id)) folders.set(id, createDriveFolder(id));
      return folders.get(id);
    },
    __reset: () => folders.clear()
  };
}

function createDocumentApp() {
  const docs = new Map();
  return {
    openById: (id) => {
      if (!docs.has(id)) docs.set(id, createDocument(id));
      return docs.get(id);
    },
    __reset: () => docs.clear()
  };
}

function createPropertiesService() {
  const userProperties = new Map();
  return {
    getUserProperties: () => ({
      getProperty: (key) => userProperties.get(key) || null,
      setProperty: (key, value) => userProperties.set(key, value),
      deleteProperty: (key) => userProperties.delete(key),
      __reset: () => userProperties.clear()
    }),
    __reset: () => userProperties.clear()
  };
}

function installGlobals(globals) {
  const gmail = createGmailApp();
  const drive = createDriveApp();
  const docs = createDocumentApp();
  const calendar = createCalendar();
  const spreadsheet = createSpreadsheet();
  const properties = createPropertiesService();

  globals.GmailApp = gmail;
  globals.DriveApp = drive;
  globals.DocumentApp = docs;
  globals.CalendarApp = { 
    getDefaultCalendar: () => calendar,
    getCalendarById: (id) => calendar
  };
  globals.SpreadsheetApp = { 
    openById: (id) => spreadsheet,
    getActiveSpreadsheet: () => spreadsheet
  };
  globals.PropertiesService = properties;

  globals.__mocks = { gmail, drive, docs, calendar, spreadsheet, properties, createMessage, createBlob, createCalendarEvent };
}

function resetAll(globals) {
  if (globals.__mocks) {
    globals.__mocks.gmail.__reset();
    globals.__mocks.drive.__reset();
    globals.__mocks.docs.__reset();
    globals.__mocks.calendar.__reset();
    globals.__mocks.spreadsheet.__reset();
    globals.__mocks.properties.__reset();
  }
}

module.exports = { installGlobals, resetAll, createMessage, createBlob, createCalendarEvent };
