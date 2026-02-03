const { getCleanBody, getFileHash } = require('../../gas-utils');

describe('getCleanBody', () => {
  test('returns empty string for falsy input', () => {
    expect(getCleanBody(null)).toBe('');
    expect(getCleanBody('')).toBe('');
  });

  test('removes quoted lines starting with > and <', () => {
    const input = 'Hello\n> quoted line\n< another quote\nWorld';
    expect(getCleanBody(input)).toBe('Hello\nWorld');
  });

  test('cuts off at reply header (On ... wrote:)', () => {
    const input = 'Line1\nOn Jan 1, 2020, John Doe <john@example.com> wrote:\nQuoted';
    expect(getCleanBody(input)).toBe('Line1');
  });

  test('cuts off at confidentiality notice', () => {
    const input = 'Message body\nThis is a confidentiality notice: do not share';
    expect(getCleanBody(input)).toBe('Message body');
  });

  test('handles match at start of text (no newline before match)', () => {
    const input = 'On Jan 1, 2020, John Doe wrote:\nQuoted content';
    // Match is at the start, so lastIndexOf will return -1
    expect(getCleanBody(input)).toBe('');
  });

  test('chooses earliest match when multiple patterns match', () => {
    const input = 'First line\nOn Jan 1, 2020, John wrote:\nSecond\nFrom: someone@example.com\nThird';
    // Both "On ... wrote:" and "From:" patterns match, should split at earliest one
    const result = getCleanBody(input);
    expect(result).toBe('First line');
  });

  test('handles multiple matches where later match is not earlier', () => {
    // Pattern 1: "___________" at beginning will match first (line 0)
    // Pattern 2: "From:...< >" later in text
    // Since second match is later, lineStart will be >= splitIndex, so we don't update
    const input = '__________\nFirst line\nSecond line\nFrom: sender <sender@example.com>\nQuoted';
    const result = getCleanBody(input);
    // Should split at the first match (underscores at line 0)
    expect(result).toBe('');
  });
});

describe('getFileHash', () => {
  test('computes md5 for a Buffer', () => {
    const buf = Buffer.from('hello world');
    expect(getFileHash(buf)).toBe('5eb63bbbe01eeed093cb22bb8f5acdc3');
  });

  test('computes md5 for an object with getBytes()', () => {
    const blob = { getBytes: () => Buffer.from('abc') };
    expect(getFileHash(blob)).toBe('900150983cd24fb0d6963f7d28e17f72');
  });

  test('computes md5 for an object with bytes property', () => {
    const blob = { bytes: Buffer.from('test') };
    expect(getFileHash(blob)).toBe('098f6bcd4621d373cade4e832627b4f6');
  });

  test('throws error for unsupported blob type', () => {
    expect(() => getFileHash('not a blob')).toThrow('Unsupported blob type');
    expect(() => getFileHash({})).toThrow('Unsupported blob type');
    expect(() => getFileHash(null)).toThrow('Unsupported blob type');
  });
});
