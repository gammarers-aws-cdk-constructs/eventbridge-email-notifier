import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { quietStringify } from 'quiet-json-parser';
import { StrictEnvResolver, StrictEnvType } from 'strict-env-resolver';
import { SUBJECT_ENV, TOPIC_ARN_ENV } from '../core/sns-publish-env';

const sns = new SNSClient({});

/** SNS body used when the payload cannot be serialized. */
const SNS_MESSAGE_FALLBACK = 'null';

/**
 * Serialize an EventBridge target payload into an SNS message body.
 *
 * String inputs are published as-is. Other values are JSON, with prototype-pollution keys omitted.
 * When the value cannot be serialized, the body is JSON null.
 *
 * @param event - Payload EventBridge passed to the function
 * @returns Message body for SNS Publish
 */
export const toSnsMessage = (event: unknown): string => {
  if (typeof event === 'string') {
    return event;
  }

  return quietStringify(event, SNS_MESSAGE_FALLBACK);
};

/**
 * Publish the EventBridge payload to SNS using the topic and subject from the environment.
 *
 * @param event - Payload EventBridge passed to the function
 * @throws StrictEnvValidationError when the topic ARN or subject is missing
 */
export const handler = async (event: unknown): Promise<void> => {
  const env = StrictEnvResolver.resolveAll({
    [TOPIC_ARN_ENV]: StrictEnvType.String,
    [SUBJECT_ENV]: StrictEnvType.String,
  });

  await sns.send(new PublishCommand({
    TopicArn: env[TOPIC_ARN_ENV],
    Subject: env[SUBJECT_ENV],
    Message: toSnsMessage(event),
  }));
};
