/**
 * Environment variable that carries the SNS topic ARN into the publisher.
 */
export const TOPIC_ARN_ENV = 'TOPIC_ARN';

/**
 * Environment variable that carries the sanitized SNS subject into the publisher.
 */
export const SUBJECT_ENV = 'SUBJECT';

/**
 * SNS Publish Subject must be shorter than 100 characters.
 *
 * @see https://docs.aws.amazon.com/sns/latest/api/API_Publish.html
 */
export const SNS_SUBJECT_MAX_LENGTH = 99;
