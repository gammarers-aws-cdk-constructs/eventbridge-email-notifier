/**
 * JSON field carrying the SNS topic ARN in the publisher payload.
 */
export const PUBLISH_TOPIC_ARN_FIELD = 'topicArn';

/**
 * JSON field carrying the SNS subject in the publisher payload.
 */
export const PUBLISH_SUBJECT_FIELD = 'subject';

/**
 * JSON field carrying the SNS message body in the publisher payload.
 */
export const PUBLISH_MESSAGE_FIELD = 'message';

/**
 * SNS Publish Subject must be shorter than 100 characters.
 *
 * @see https://docs.aws.amazon.com/sns/latest/api/API_Publish.html
 */
export const SNS_SUBJECT_MAX_LENGTH = 99;

/**
 * Attempts for one SNS Publish, including the first try.
 */
export const SNS_CLIENT_MAX_ATTEMPTS = 3;

/**
 * TCP connection budget for one SNS Publish attempt.
 */
export const SNS_CLIENT_CONNECTION_TIMEOUT_MS = 5_000;

/**
 * Response budget for one SNS Publish attempt.
 */
export const SNS_CLIENT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Publisher Lambda timeout, in seconds.
 *
 * Exceeds the connection and request budgets across every attempt
 * (5s × 3 + 30s × 3 = 105s) so SDK retries finish inside the invocation.
 */
export const PUBLISHER_TIMEOUT_SECONDS = 120;
