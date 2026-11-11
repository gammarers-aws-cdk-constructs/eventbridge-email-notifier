import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { quietStringify } from 'quiet-json-parser';
import { parsePublishRequest } from './core/parse-publish-request';
import { sanitizeSnsSubject } from './core/sanitize-sns-subject';

const sns = new SNSClient({
  maxAttempts: 3,
});

/** SNS body used when the payload cannot be serialized. */
const SNS_MESSAGE_FALLBACK = 'null';

/**
 * Serialize the publisher `message` field into an SNS message body.
 *
 * String inputs are published as-is. Other values are JSON, with prototype-pollution keys omitted.
 * When the value cannot be serialized, the body is JSON null.
 *
 * @param event - `message` value from the publisher payload
 * @returns Message body for SNS Publish
 */
export const toSnsMessage = (event: unknown): string => {
  if (typeof event === 'string') {
    return event;
  }

  return quietStringify(event, SNS_MESSAGE_FALLBACK);
};

/**
 * Publish the EventBridge payload to SNS.
 *
 * The event is `{ topicArn, subject, message }` from the input transformer.
 * The subject is sanitized to SNS limits before Publish.
 *
 * @param event - Payload EventBridge passed to the function
 * @throws Error when the payload is missing `topicArn`, `subject`, or `message`, or the subject is empty after sanitization
 */
export const handler = async (event: unknown): Promise<void> => {
  const request = parsePublishRequest(event);
  const subject = sanitizeSnsSubject(request.subject);

  if (subject.length === 0) {
    throw new Error(
      'subject must contain at least one non-control character after sanitization',
    );
  }

  await sns.send(new PublishCommand({
    TopicArn: request.topicArn,
    Subject: subject,
    Message: toSnsMessage(request.message),
  }));
};
