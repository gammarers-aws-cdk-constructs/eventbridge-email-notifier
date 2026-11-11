import { App, Duration, Lazy, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as events from 'aws-cdk-lib/aws-events';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { EventBridgeEmailNotifier } from '../src';

const REMOVED_SUBJECT_ENV = 'SUBJECT';
const REMOVED_TOPIC_ARN_ENV = 'TOPIC_ARN';

const createStackWithRule = () => {
  const app = new App();
  const stack = new Stack(app, 'TestStack');
  const topic = new sns.Topic(stack, 'Topic');
  const rule = new events.Rule(stack, 'Rule', {
    eventPattern: {
      source: ['aws.codepipeline'],
    },
  });
  return { stack, topic, rule };
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const targetPayloadText = (template: Template): string => {
  const rules = template.findResources('AWS::Events::Rule');
  const chunks: string[] = [];

  for (const resource of Object.values(rules)) {
    const properties: unknown = resource.Properties;
    if (!isRecord(properties) || !Array.isArray(properties.Targets)) {
      continue;
    }

    for (const target of properties.Targets) {
      chunks.push(JSON.stringify(target));
    }
  }

  return chunks.join('\n');
};

const lambdaVariable = (
  resource: { [key: string]: unknown },
  name: string,
): unknown => {
  const properties: unknown = resource.Properties;
  if (!isRecord(properties) || !isRecord(properties.Environment)) {
    return undefined;
  }

  const variables: unknown = properties.Environment.Variables;
  if (!isRecord(variables)) {
    return undefined;
  }

  return variables[name];
};

describe('EventBridgeEmailNotifier', () => {
  test('routes EventBridge through Lambda to SNS with custom subject', () => {
    const { stack, topic, rule } = createStackWithRule();

    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: 'Pipeline failed',
      message: events.RuleTargetInput.fromText('Check the pipeline'),
    }));

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs24.x',
      Handler: 'index.handler',
      Code: {
        ZipFile: Match.absent(),
      },
    });

    const payload = targetPayloadText(template);
    expect(payload).toContain('Pipeline failed');
    expect(payload).toContain('Check the pipeline');
    expect(payload).toContain('EventBridgeEmailNotifier');

    for (const resource of Object.values(template.findResources('AWS::Lambda::Function'))) {
      expect(lambdaVariable(resource, REMOVED_SUBJECT_ENV)).toBeUndefined();
      expect(lambdaVariable(resource, REMOVED_TOPIC_ARN_ENV)).toBeUndefined();
    }

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'sns:Publish',
            Effect: 'Allow',
          }),
        ]),
      },
    });
  });

  test('publishes the whole event when message is omitted', () => {
    const { stack, topic, rule } = createStackWithRule();

    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: 'Pipeline failed',
    }));

    const payload = targetPayloadText(Template.fromStack(stack));
    expect(payload).toContain('Pipeline failed');
    expect(payload).toContain('<aws.events.event.json>');
  });

  test.each<[string, string | events.RuleTargetInput]>([
    ['an event field', events.EventField.fromPath('$.detail.state')],
    ['an event path', events.RuleTargetInput.fromEventPath('$.detail.state')],
    ['text that contains an event field', events.RuleTargetInput.fromText(events.EventField.fromPath('$.detail.state'))],
  ])('reads the subject from %s', (_label, subject) => {
    const { stack, topic, rule } = createStackWithRule();

    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject,
    }));

    const payload = targetPayloadText(Template.fromStack(stack));
    expect(payload).toContain('$.detail.state');
    expect(payload).toContain('<aws.events.event.json>');
  });

  test('passes a static object subject through as JSON', () => {
    const { stack, topic, rule } = createStackWithRule();

    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: events.RuleTargetInput.fromObject({
        text: 'hello',
      }),
    }));

    expect(targetPayloadText(Template.fromStack(stack))).toContain('hello');
  });

  test('keeps one object field as the subject value', () => {
    const { stack, topic, rule } = createStackWithRule();

    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: events.RuleTargetInput.fromObject({
        state: events.EventField.fromPath('$.detail.state'),
      }),
    }));

    const payload = targetPayloadText(Template.fromStack(stack));
    expect(payload).toContain('$.detail.state');
    expect(payload).toContain('<subject_detail-state>');
  });

  test('passes an object subject through the input transformer', () => {
    const { stack, topic, rule } = createStackWithRule();

    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: events.RuleTargetInput.fromObject({
        state: events.EventField.fromPath('$.detail.state'),
        pipeline: events.EventField.fromPath('$.detail.pipeline'),
      }),
    }));

    const payload = targetPayloadText(Template.fromStack(stack));
    expect(payload).toContain('$.detail.state');
    expect(payload).toContain('$.detail.pipeline');
    expect(payload).toContain('<subject_detail-state>');
    expect(payload).toContain('<subject_detail-pipeline>');
  });

  test('embeds message fields from the event', () => {
    const { stack, topic, rule } = createStackWithRule();

    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: 'Pipeline failed',
      message: events.RuleTargetInput.fromObject({
        pipeline: events.EventField.fromPath('$.detail.pipeline'),
        state: events.EventField.fromPath('$.detail.state'),
      }),
    }));

    const payload = targetPayloadText(Template.fromStack(stack));
    expect(payload).toContain('Pipeline failed');
    expect(payload).toContain('$.detail.pipeline');
    expect(payload).toContain('$.detail.state');
    expect(payload).toContain('<message_detail-pipeline>');
    expect(payload).toContain('<message_detail-state>');
    expect(payload).not.toContain('<aws.events.event.json>');
  });

  test('sanitizes subject for SNS constraints', () => {
    const { stack, topic, rule } = createStackWithRule();

    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: `Alert\n${'x'.repeat(120)}`,
    }));

    const payload = targetPayloadText(Template.fromStack(stack));
    expect(payload).toContain(`Alert${'x'.repeat(94)}`);
    expect(payload).not.toContain(`Alert\n${'x'.repeat(120)}`);
  });

  test('sanitizes a static RuleTargetInput subject', () => {
    const { stack, topic, rule } = createStackWithRule();

    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: events.RuleTargetInput.fromText(`Alert\n${'x'.repeat(120)}`),
    }));

    const payload = targetPayloadText(Template.fromStack(stack));
    expect(payload).toContain(`Alert${'x'.repeat(94)}`);
  });

  test('rejects subject that becomes empty after sanitization', () => {
    const { topic } = createStackWithRule();

    expect(() => {
      new EventBridgeEmailNotifier(topic, {
        subject: '\n\r\t',
      });
    }).toThrow(/non-control character/);
  });

  test('rejects a static RuleTargetInput subject that sanitizes to empty', () => {
    const { topic, rule } = createStackWithRule();

    expect(() => {
      new EventBridgeEmailNotifier(topic, {
        subject: events.RuleTargetInput.fromText('\n'),
      }).bind(rule);
    }).toThrow(/non-control character/);
  });

  test('rejects an unresolved subject token that is not an event path', () => {
    const { topic } = createStackWithRule();

    expect(() => {
      new EventBridgeEmailNotifier(topic, {
        subject: Lazy.string({ produce: () => 'later' }),
      });
    }).toThrow(/event path/);
  });

  test('creates distinct Lambdas for different subjects on the same rule', () => {
    const { stack, topic, rule } = createStackWithRule();

    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: 'First subject',
      message: events.RuleTargetInput.fromText('first'),
    }));
    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: 'Second subject',
      message: events.RuleTargetInput.fromText('second'),
    }));

    const template = Template.fromStack(stack);
    expect(Object.keys(template.findResources('AWS::Lambda::Function'))).toHaveLength(2);

    const payload = targetPayloadText(template);
    expect(payload).toContain('First subject');
    expect(payload).toContain('Second subject');
    expect(payload).toContain('first');
    expect(payload).toContain('second');
  });

  test('reuses one Lambda when topic and subject match on the same rule', () => {
    const { stack, topic, rule } = createStackWithRule();

    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: 'Same subject',
      message: events.RuleTargetInput.fromText('one'),
    }));
    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: 'Same subject',
      message: events.RuleTargetInput.fromText('two'),
    }));

    const template = Template.fromStack(stack);
    expect(Object.keys(template.findResources('AWS::Lambda::Function'))).toHaveLength(1);
    template.resourceCountIs('AWS::Events::Rule', 1);

    const payload = targetPayloadText(template);
    expect(payload).toContain('one');
    expect(payload).toContain('two');
  });

  test('reuses one Lambda when the event path is the same', () => {
    const { stack, topic, rule } = createStackWithRule();

    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: events.EventField.fromPath('$.detail.state'),
      message: events.RuleTargetInput.fromText('one'),
    }));
    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: events.RuleTargetInput.fromEventPath('$.detail.state'),
      message: events.RuleTargetInput.fromText('two'),
    }));

    const template = Template.fromStack(stack);
    expect(Object.keys(template.findResources('AWS::Lambda::Function'))).toHaveLength(1);

    const payload = targetPayloadText(template);
    expect(payload).toContain('one');
    expect(payload).toContain('two');
    expect(payload).toContain('$.detail.state');
  });

  test('creates distinct Lambdas when bind is called without an id', () => {
    const { stack, topic, rule } = createStackWithRule();

    const alpha = new EventBridgeEmailNotifier(topic, { subject: 'Alpha' }).bind(rule);
    const beta = new EventBridgeEmailNotifier(topic, { subject: 'Beta' }).bind(rule);

    const template = Template.fromStack(stack);
    expect(Object.keys(template.findResources('AWS::Lambda::Function'))).toHaveLength(2);
    expect(JSON.stringify(alpha.input?.bind(rule))).toContain('Alpha');
    expect(JSON.stringify(beta.input?.bind(rule))).toContain('Beta');
  });

  test('configures EventBridge target DLQ and retry policy', () => {
    const { stack, topic, rule } = createStackWithRule();
    const dlq = new sqs.Queue(stack, 'Dlq');

    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: 'With retries',
      deadLetterQueue: dlq,
      retryAttempts: 2,
      maxEventAge: Duration.hours(2),
    }));

    const template = Template.fromStack(stack);
    const payload = targetPayloadText(template);
    expect(payload).toContain('MaximumRetryAttempts');
    expect(payload).toContain('7200');
    expect(payload).toContain('DeadLetterConfig');

    template.hasResourceProperties('AWS::SQS::QueuePolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'sqs:SendMessage',
            Effect: 'Allow',
            Principal: {
              Service: 'events.amazonaws.com',
            },
          }),
        ]),
      },
    });
  });
});
