const crypto = require('crypto');

/**
 * getCleanBody - logic ported from GAS for local testing
 */
function getCleanBody(text) {
  if (!text) return '';

  const headerPatterns = [
    /^\s*On\s+.+\s+wrote:/m,
    /^\s*From:\s+.+\s+Sent:\s+/m,
    /^\s*_{10,}/m,
    /^\s*From:\s+.+<.+@.+>/m,
    /confidentiality notice/im
  ];

  let splitIndex = -1;
  headerPatterns.forEach((pattern) => {
    const match = text.match(pattern);
    if (match) {
      // Prefer splitting at the start of the line containing the match
      const lineStart = (text.lastIndexOf('\n', match.index) === -1) ? 0 : text.lastIndexOf('\n', match.index) + 1;
      if (splitIndex === -1 || lineStart < splitIndex) {
        splitIndex = lineStart;
      }
    }
  });

  const workingText = splitIndex !== -1 ? text.substring(0, splitIndex) : text;
  const lines = workingText.split('\n');
  const cleanLines = lines.filter((line) => {
    const trimmed = line.trim();
    return !(trimmed.startsWith('>') || trimmed.startsWith('<'));
  });

  // Join lines and normalize line breaks: replace 2+ consecutive line breaks with 1
  // This prevents excessive blank lines in Google Docs where each \n creates a paragraph break
  let result = cleanLines.join('\n').trim();
  result = result.replace(/\n{2,}/g, '\n');
  
  return result;
}

/**
 * getFileHash - compute MD5 hex digest of a "blob" (Buffer or object with getBytes())
 */
function getFileHash(blob) {
  let bytes;
  if (Buffer.isBuffer(blob)) {
    bytes = blob;
  } else if (blob && typeof blob.getBytes === 'function') {
    bytes = Buffer.from(blob.getBytes());
  } else if (blob && blob.bytes) {
    bytes = Buffer.from(blob.bytes);
  } else {
    throw new Error('Unsupported blob type');
  }

  const hash = crypto.createHash('md5').update(bytes).digest('hex');
  return hash;
}

module.exports = { getCleanBody, getFileHash };
