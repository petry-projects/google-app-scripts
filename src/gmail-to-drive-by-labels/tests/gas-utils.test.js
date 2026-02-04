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

  test('handles match at start of text (lineStart = 0)', () => {
    const input = 'On Jan 1, 2020, John Doe <john@example.com> wrote:\nQuoted content here';
    expect(getCleanBody(input)).toBe('');
  });

  test('preserves text when no patterns match', () => {
    const input = 'Regular email content\nNo special patterns here';
    expect(getCleanBody(input)).toBe('Regular email content\nNo special patterns here');
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
