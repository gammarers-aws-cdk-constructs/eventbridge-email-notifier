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
