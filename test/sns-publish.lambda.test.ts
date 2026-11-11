import { handler, toSnsMessage } from '../src/funcs/sns-publish.lambda';
import {
  PUBLISH_MESSAGE_FIELD,
  PUBLISH_SUBJECT_FIELD,
  PUBLISH_TOPIC_ARN_FIELD,
} from '../src/settings/consts';

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
  test('fails when the payload is not an object', async () => {
    await expect(handler('Pipeline failed')).rejects.toThrow(/topicArn, subject, and message/);
  });

  test('fails when the subject is empty after sanitization', async () => {
    await expect(handler({
      [PUBLISH_TOPIC_ARN_FIELD]: 'arn:aws:sns:us-east-1:123456789012:alerts',
      [PUBLISH_SUBJECT_FIELD]: '\n\t',
      [PUBLISH_MESSAGE_FIELD]: 'Check the pipeline',
    })).rejects.toThrow(/non-control character/);
  });

  test('fails when topicArn is missing', async () => {
    await expect(handler({
      [PUBLISH_SUBJECT_FIELD]: 'Pipeline failed',
      [PUBLISH_MESSAGE_FIELD]: 'Check the pipeline',
    })).rejects.toThrow(/topicArn/);
  });
});
