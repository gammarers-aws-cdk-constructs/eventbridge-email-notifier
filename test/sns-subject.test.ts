import {
  SNS_SUBJECT_MAX_LENGTH,
  sanitizeSnsSubject,
} from '../src/core/sns-subject';

describe('sanitizeSnsSubject', () => {
  it.each([
    ['plain subject', 'plain subject'],
    ['line\nbreak', 'linebreak'],
    ['carriage\rreturn', 'carriagereturn'],
    ['tab\there', 'tabhere'],
    ['keep spaces between words', 'keep spaces between words'],
    ['\u0000null\u001Funit', 'nullunit'],
    ['\u007Fdel\u009F', 'del'],
  ])('sanitizes %j', (input, expected) => {
    expect(sanitizeSnsSubject(input)).toBe(expected);
  });

  it('truncates to SNS_SUBJECT_MAX_LENGTH', () => {
    const input = 'a'.repeat(SNS_SUBJECT_MAX_LENGTH + 20);
    const result = sanitizeSnsSubject(input);

    expect(result).toHaveLength(SNS_SUBJECT_MAX_LENGTH);
    expect(result).toBe('a'.repeat(SNS_SUBJECT_MAX_LENGTH));
  });

  it('removes controls before truncating', () => {
    const input = `${'b'.repeat(50)}\n${'c'.repeat(60)}`;
    const result = sanitizeSnsSubject(input);

    expect(result).toBe(`${'b'.repeat(50)}${'c'.repeat(49)}`);
    expect(result).toHaveLength(SNS_SUBJECT_MAX_LENGTH);
    expect(result.includes('\n')).toBe(false);
  });
});
