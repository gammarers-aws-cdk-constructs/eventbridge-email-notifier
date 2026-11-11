import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { handler, toSnsMessage } from '../src/funcs/sns-publish.lambda';
import {
  PUBLISH_MESSAGE_FIELD,
  PUBLISH_SUBJECT_FIELD,
  PUBLISH_TOPIC_ARN_FIELD,
  SNS_SUBJECT_MAX_LENGTH,
} from '../src/settings/consts';

// The publisher constructs SNSClient at import time. mockClient stubs send on the class.
const snsMock = mockClient(SNSClient);
const topicArn = 'arn:aws:sns:us-east-1:123456789012:alerts';

const publishEvent = (subject: string, message: unknown): Record<string, unknown> => {
  return {
    [PUBLISH_TOPIC_ARN_FIELD]: topicArn,
    [PUBLISH_SUBJECT_FIELD]: subject,
    [PUBLISH_MESSAGE_FIELD]: message,
  };
};

describe('toSnsMessage', () => {
  test.each([
    ['Check the pipeline', 'Check the pipeline'],
    [{ source: 'aws.codepipeline' }, '{"source":"aws.codepipeline"}'],
    [null, 'null'],
    [undefined, 'null'],
  ])('serializes %j', (event, expected) => {
    expect(toSnsMessage(event)).toBe(expected);
  });

  test('omits prototype pollution keys from object payloads', () => {
    const event = JSON.parse('{"__proto__":{"admin":true},"source":"aws.codepipeline"}') as unknown;

    expect(toSnsMessage(event)).toBe('{"source":"aws.codepipeline"}');
  });
});

describe('handler', () => {
  beforeEach(() => {
    snsMock.reset();
    snsMock.on(PublishCommand).resolves({});
  });

  test.each([
    ['a string message', 'Check the pipeline', 'Check the pipeline'],
    ['an object message', { source: 'aws.codepipeline' }, '{"source":"aws.codepipeline"}'],
    ['a null message', null, 'null'],
  ])('publishes %s', async (_label, message, expected) => {
    await handler(publishEvent('Pipeline failed', message));

    expect(snsMock).toHaveReceivedCommandTimes(PublishCommand, 1);
    expect(snsMock).toHaveReceivedCommandWith(PublishCommand, {
      TopicArn: topicArn,
      Subject: 'Pipeline failed',
      Message: expected,
    });
  });

  test('publishes a sanitized subject', async () => {
    const raw = `Alert\n${'x'.repeat(SNS_SUBJECT_MAX_LENGTH)}`;
    const subject = `Alert${'x'.repeat(SNS_SUBJECT_MAX_LENGTH - 'Alert'.length)}`;

    await handler(publishEvent(raw, 'body'));

    expect(snsMock).toHaveReceivedCommandWith(PublishCommand, {
      TopicArn: topicArn,
      Subject: subject,
      Message: 'body',
    });
  });

  test('fails when the payload is not an object', async () => {
    await expect(handler('Pipeline failed')).rejects.toThrow(/topicArn, subject, and message/);
    expect(snsMock).not.toHaveReceivedCommand(PublishCommand);
  });

  test('fails when the subject is empty after sanitization', async () => {
    await expect(handler(publishEvent('\n\t', 'Check the pipeline'))).rejects.toThrow(/non-control character/);
    expect(snsMock).not.toHaveReceivedCommand(PublishCommand);
  });

  test('fails when topicArn is missing', async () => {
    await expect(handler({
      [PUBLISH_SUBJECT_FIELD]: 'Pipeline failed',
      [PUBLISH_MESSAGE_FIELD]: 'Check the pipeline',
    })).rejects.toThrow(/topicArn/);
    expect(snsMock).not.toHaveReceivedCommand(PublishCommand);
  });
});
