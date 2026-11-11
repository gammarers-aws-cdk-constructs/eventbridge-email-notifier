import { parsePublishRequest } from '../src/funcs/core/parse-publish-request';
import {
  PUBLISH_MESSAGE_FIELD,
  PUBLISH_SUBJECT_FIELD,
  PUBLISH_TOPIC_ARN_FIELD,
} from '../src/settings/consts';

const topicArn = 'arn:aws:sns:us-east-1:123456789012:alerts';

describe('parsePublishRequest', () => {
  test('reads topic, subject, and message', () => {
    expect(parsePublishRequest({
      [PUBLISH_TOPIC_ARN_FIELD]: topicArn,
      [PUBLISH_SUBJECT_FIELD]: 'Pipeline failed',
      [PUBLISH_MESSAGE_FIELD]: { state: 'FAILED' },
    })).toEqual({
      topicArn,
      subject: 'Pipeline failed',
      message: { state: 'FAILED' },
    });
  });

  test('keeps a null message', () => {
    expect(parsePublishRequest({
      [PUBLISH_TOPIC_ARN_FIELD]: topicArn,
      [PUBLISH_SUBJECT_FIELD]: 'Pipeline failed',
      [PUBLISH_MESSAGE_FIELD]: null,
    })).toEqual({
      topicArn,
      subject: 'Pipeline failed',
      message: null,
    });
  });

  test.each([
    ['a string', 'Pipeline failed'],
    ['an array', ['Pipeline failed']],
    ['null', null],
  ])('rejects %s', (_label, event) => {
    expect(() => parsePublishRequest(event)).toThrow(/topicArn, subject, and message/);
  });

  test('rejects a missing message', () => {
    expect(() => parsePublishRequest({
      [PUBLISH_TOPIC_ARN_FIELD]: topicArn,
      [PUBLISH_SUBJECT_FIELD]: 'Pipeline failed',
    })).toThrow(/message/);
  });

  test.each([
    ['missing', {}],
    ['empty', { [PUBLISH_TOPIC_ARN_FIELD]: '' }],
    ['not a string', { [PUBLISH_TOPIC_ARN_FIELD]: 12 }],
  ])('rejects a topicArn that is %s', (_label, event) => {
    expect(() => parsePublishRequest({
      ...event,
      [PUBLISH_SUBJECT_FIELD]: 'Pipeline failed',
      [PUBLISH_MESSAGE_FIELD]: 'body',
    })).toThrow(/topicArn/);
  });

  test('rejects a subject that is not a string', () => {
    expect(() => parsePublishRequest({
      [PUBLISH_TOPIC_ARN_FIELD]: topicArn,
      [PUBLISH_SUBJECT_FIELD]: { state: 'FAILED' },
      [PUBLISH_MESSAGE_FIELD]: 'body',
    })).toThrow(/subject must be a string/);
  });
});
