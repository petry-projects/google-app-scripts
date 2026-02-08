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

  test('normalizes multiple consecutive line breaks to single line break', () => {
    const input = 'Paragraph 1\n\n\n\nParagraph 2';
    const result = getCleanBody(input);
    // Should normalize to single line break (no blank lines)
    expect(result).not.toContain('\n\n');
    expect(result).toBe('Paragraph 1\nParagraph 2');
  });

  test('handles multiple occurrences of excessive line breaks', () => {
    const input = 'Line 1\n\n\nLine 2\n\n\n\n\nLine 3';
    const result = getCleanBody(input);
    expect(result).toBe('Line 1\nLine 2\nLine 3');
  });

  test('preserves single line breaks', () => {
    const input = 'Line 1\nLine 2\nLine 3';
    expect(getCleanBody(input)).toBe('Line 1\nLine 2\nLine 3');
  });

  test('normalizes double line breaks to single (for signatures)', () => {
    const input = 'Paragraph 1\n\nParagraph 2';
    expect(getCleanBody(input)).toBe('Paragraph 1\nParagraph 2');
  });

  test('handles email signature with excessive line breaks', () => {
    const input = 'Thank you!\n\n\n\nJohn Doe\n\nSoftware Engineer\n\n\nAcme Corp';
    const result = getCleanBody(input);
    expect(result).toBe('Thank you!\nJohn Doe\nSoftware Engineer\nAcme Corp');
    expect(result).not.toContain('\n\n');
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
