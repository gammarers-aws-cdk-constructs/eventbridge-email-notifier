import { StrictEnvValidationError } from 'strict-env-resolver';
import { SUBJECT_ENV, TOPIC_ARN_ENV } from '../src/core/sns-publish-env';
import { handler, toSnsMessage } from '../src/funcs/sns-publish.lambda';

const restoreEnv = (name: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
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
  test('fails when the topic or subject is missing', async () => {
    const previousTopicArn = process.env[TOPIC_ARN_ENV];
    const previousSubject = process.env[SUBJECT_ENV];
    delete process.env[TOPIC_ARN_ENV];
    delete process.env[SUBJECT_ENV];

    try {
      await expect(handler({ source: 'aws.codepipeline' })).rejects.toBeInstanceOf(StrictEnvValidationError);
    } finally {
      restoreEnv(TOPIC_ARN_ENV, previousTopicArn);
      restoreEnv(SUBJECT_ENV, previousSubject);
    }
  });
});
