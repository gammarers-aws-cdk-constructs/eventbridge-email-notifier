import { SNS_SUBJECT_MAX_LENGTH } from '../../settings/consts';

/** Control characters forbidden in SNS Subject (line breaks and other Cc). */
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Sanitize a runtime subject for SNS Publish.
 *
 * Removes control characters (including newlines) and truncates to
 * {@link SNS_SUBJECT_MAX_LENGTH} characters. Static subjects are checked
 * again here so event-derived values follow the same limit.
 *
 * @param subject - Subject text taken from the publisher payload
 * @returns Sanitized subject safe for SNS Publish
 */
export const sanitizeSnsSubject = (subject: string): string => {
  const withoutControls = subject.replace(CONTROL_CHARACTER_PATTERN, '');
  return withoutControls.slice(0, SNS_SUBJECT_MAX_LENGTH);
};
