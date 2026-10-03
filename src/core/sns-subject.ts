/**
 * SNS Publish Subject must be shorter than 100 characters.
 *
 * @see https://docs.aws.amazon.com/sns/latest/api/API_Publish.html
 */
export const SNS_SUBJECT_MAX_LENGTH = 99;

/**
 * Control characters forbidden in SNS Subject (line breaks and other Cc).
 */
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Sanitize a string for use as an SNS email Subject.
 *
 * Removes control characters (including newlines) and truncates to
 * {@link SNS_SUBJECT_MAX_LENGTH} characters.
 *
 * @param subject - Candidate subject text
 * @returns Sanitized subject safe for SNS Publish
 */
export const sanitizeSnsSubject = (subject: string): string => {
  const withoutControls = subject.replace(CONTROL_CHARACTER_PATTERN, '');
  return withoutControls.slice(0, SNS_SUBJECT_MAX_LENGTH);
};
