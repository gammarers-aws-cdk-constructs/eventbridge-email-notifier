import { App, Duration, Lazy, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as events from 'aws-cdk-lib/aws-events';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { EventBridgeEmailNotifier } from '../src';
import { PUBLISHER_TIMEOUT_SECONDS } from '../src/settings/consts';

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

class TargetInput extends events.RuleTargetInput {
  public constructor(private readonly properties: events.RuleTargetInputProperties) {
    super();
  }

  public bind(): events.RuleTargetInputProperties {
    return this.properties;
  }
}

class TopicPathInput extends events.RuleTargetInput {
  public constructor(
    private readonly topic: sns.ITopic,
    private readonly path: string,
  ) {
    super();
  }

  public bind(rule: events.IRuleRef): events.RuleTargetInputProperties {
    const stack = Construct.isConstruct(rule) ? Stack.of(rule) : Stack.of(this.topic);

    return {
      inputTemplate: stack.toJsonString(this.topic.topicArn),
      inputPathsMap: { detail: this.path },
    };
  }
}

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

const ruleTargets = (template: Template): Record<string, unknown>[] => {
  const targets: Record<string, unknown>[] = [];

  for (const resource of Object.values(template.findResources('AWS::Events::Rule'))) {
    const properties: unknown = resource.Properties;
    if (!isRecord(properties) || !Array.isArray(properties.Targets)) {
      continue;
    }

    for (const target of properties.Targets) {
      if (isRecord(target)) {
        targets.push(target);
      }
    }
  }

  return targets;
};

const publishStatementCount = (template: Template): number => {
  let count = 0;

  for (const resource of Object.values(template.findResources('AWS::IAM::Policy'))) {
    const properties: unknown = resource.Properties;
    if (!isRecord(properties) || !isRecord(properties.PolicyDocument)) {
      continue;
    }

    const statements: unknown = properties.PolicyDocument.Statement;
    if (!Array.isArray(statements)) {
      continue;
    }

    for (const statement of statements) {
      if (!isRecord(statement)) {
        continue;
      }

      const actions = Array.isArray(statement.Action) ? statement.Action : [statement.Action];
      if (actions.includes('sns:Publish')) {
        count += 1;
      }
    }
  }

  return count;
};

const targetFunctionId = (target: Record<string, unknown>): string => {
  const arn = target.Arn;
  if (!isRecord(arn) || !Array.isArray(arn['Fn::GetAtt'])) {
    throw new Error('target Arn must be a function GetAtt');
  }

  const logicalId = arn['Fn::GetAtt'][0];
  if (typeof logicalId !== 'string') {
    throw new Error('target Arn must name a function');
  }

  return logicalId;
};

/**
 * Shared publisher wiring: one rule, the expected Lambda count, and no subject env vars.
 */
const expectPublisherWiring = (template: Template, lambdaCount: number): void => {
  template.resourceCountIs('AWS::Events::Rule', 1);
  template.resourceCountIs('AWS::Lambda::Function', lambdaCount);
  template.hasResourceProperties('AWS::Lambda::Function', {
    Runtime: 'nodejs24.x',
    Handler: 'index.handler',
    Timeout: PUBLISHER_TIMEOUT_SECONDS,
    Code: {
      ZipFile: Match.absent(),
    },
  });

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
};

describe('EventBridgeEmailNotifier', () => {
  test('routes EventBridge through Lambda to SNS with custom subject', () => {
    const { stack, topic, rule } = createStackWithRule();

    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: 'Pipeline failed',
      message: events.RuleTargetInput.fromText('Check the pipeline'),
    }));

    const template = Template.fromStack(stack);
    expectPublisherWiring(template, 1);

    const payload = targetPayloadText(template);
    expect(payload).toContain('Pipeline failed');
    expect(payload).toContain('Check the pipeline');
    expect(payload).toContain('EventBridgeEmailNotifier');
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

  test('uses one Lambda for different subjects on the same rule', () => {
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
    expectPublisherWiring(template, 1);
    expect(publishStatementCount(template)).toBe(1);
    expect(Object.keys(template.findResources('AWS::Lambda::Function'))[0])
      .toContain('EventBridgeEmailNotifier');

    const targets = ruleTargets(template);
    expect(targets).toHaveLength(2);
    expect(targetFunctionId(targets[0])).toBe(targetFunctionId(targets[1]));

    const first = JSON.stringify(targets[0]);
    const second = JSON.stringify(targets[1]);
    expect(first).toContain('First subject');
    expect(first).toContain('first');
    expect(first).not.toContain('Second subject');
    expect(second).toContain('Second subject');
    expect(second).toContain('second');
    expect(second).not.toContain('First subject');
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
    expectPublisherWiring(template, 1);
    expect(publishStatementCount(template)).toBe(1);

    const targets = ruleTargets(template);
    expect(targets).toHaveLength(2);
    expect(targetFunctionId(targets[0])).toBe(targetFunctionId(targets[1]));
    expect(JSON.stringify(targets[0])).toContain('Same subject');
    expect(JSON.stringify(targets[0])).toContain('one');
    expect(JSON.stringify(targets[0])).not.toContain('two');
    expect(JSON.stringify(targets[1])).toContain('Same subject');
    expect(JSON.stringify(targets[1])).toContain('two');
    expect(JSON.stringify(targets[1])).not.toContain('"one"');
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
    expectPublisherWiring(template, 1);

    const targets = ruleTargets(template);
    expect(targets).toHaveLength(2);
    expect(targetFunctionId(targets[0])).toBe(targetFunctionId(targets[1]));
    expect(JSON.stringify(targets[0])).toContain('$.detail.state');
    expect(JSON.stringify(targets[0])).toContain('one');
    expect(JSON.stringify(targets[1])).toContain('$.detail.state');
    expect(JSON.stringify(targets[1])).toContain('two');
  });

  test('uses one Lambda for the same subject on different topics', () => {
    const { stack, topic, rule } = createStackWithRule();
    const other = new sns.Topic(stack, 'OtherTopic');

    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: 'Same subject',
      message: events.RuleTargetInput.fromText('one'),
    }));
    rule.addTarget(new EventBridgeEmailNotifier(other, {
      subject: 'Same subject',
      message: events.RuleTargetInput.fromText('two'),
    }));

    const template = Template.fromStack(stack);
    expectPublisherWiring(template, 1);
    expect(publishStatementCount(template)).toBe(2);

    const targets = ruleTargets(template);
    expect(targets).toHaveLength(2);
    expect(targetFunctionId(targets[0])).toBe(targetFunctionId(targets[1]));
    expect(JSON.stringify(targets[0])).toContain('one');
    expect(JSON.stringify(targets[1])).toContain('two');
  });

  test('uses one Lambda when bind is called without an id', () => {
    const { stack, topic, rule } = createStackWithRule();

    const alpha = new EventBridgeEmailNotifier(topic, { subject: 'Alpha' }).bind(rule);
    const beta = new EventBridgeEmailNotifier(topic, { subject: 'Beta' }).bind(rule);

    const template = Template.fromStack(stack);
    expect(Object.keys(template.findResources('AWS::Lambda::Function'))).toHaveLength(1);
    expect(JSON.stringify(alpha.input?.bind(rule))).toContain('Alpha');
    expect(JSON.stringify(beta.input?.bind(rule))).toContain('Beta');
  });

  test('uses one publisher for every rule in the stack', () => {
    const { stack, topic, rule } = createStackWithRule();
    const other = new events.Rule(stack, 'OtherRule', {
      eventPattern: { source: ['aws.codepipeline'] },
    });

    rule.addTarget(new EventBridgeEmailNotifier(topic, { subject: 'First subject' }));
    other.addTarget(new EventBridgeEmailNotifier(topic, { subject: 'Second subject' }));

    const template = Template.fromStack(stack);
    template.resourceCountIs('AWS::Lambda::Function', 1);
    template.resourceCountIs('AWS::Lambda::Permission', 2);
    template.resourceCountIs('AWS::Events::Rule', 2);
    expect(publishStatementCount(template)).toBe(1);

    const targets = ruleTargets(template);
    expect(targets).toHaveLength(2);
    expect(targetFunctionId(targets[0])).toBe(targetFunctionId(targets[1]));
  });

  test('creates a publisher in each stack', () => {
    const app = new App();
    const left = new Stack(app, 'Left');
    const right = new Stack(app, 'Right');
    const leftRule = new events.Rule(left, 'Rule', {
      eventPattern: { source: ['aws.codepipeline'] },
    });
    const rightRule = new events.Rule(right, 'Rule', {
      eventPattern: { source: ['aws.codepipeline'] },
    });

    leftRule.addTarget(new EventBridgeEmailNotifier(new sns.Topic(left, 'Topic'), {
      subject: 'Left subject',
    }));
    rightRule.addTarget(new EventBridgeEmailNotifier(new sns.Topic(right, 'Topic'), {
      subject: 'Right subject',
    }));

    Template.fromStack(left).resourceCountIs('AWS::Lambda::Function', 1);
    Template.fromStack(right).resourceCountIs('AWS::Lambda::Function', 1);
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
    expectPublisherWiring(template, 1);
    template.hasResourceProperties('AWS::Events::Rule', {
      Targets: Match.arrayWith([
        Match.objectLike({
          DeadLetterConfig: {
            Arn: Match.anyValue(),
          },
          RetryPolicy: {
            MaximumRetryAttempts: 2,
            MaximumEventAgeInSeconds: 7200,
          },
        }),
      ]),
    });

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

  test('rejects an input that is not text, a path, or an object template', () => {
    const { topic, rule } = createStackWithRule();

    const target = new EventBridgeEmailNotifier(topic, {
      subject: new TargetInput({}),
    }).bind(rule);

    expect(() => target.input?.bind(rule)).toThrow(/text, an event path, or an object input/);
  });

  test('passes a constant input template through without path keys', () => {
    const { stack, topic, rule } = createStackWithRule();

    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: 'Static subject',
      message: new TargetInput({ inputTemplate: '{"note":"fixed"}' }),
    }));

    expect(targetPayloadText(Template.fromStack(stack))).toContain('fixed');
  });

  test('keeps a subject fragment that is not JSON', () => {
    const { stack, topic, rule } = createStackWithRule();

    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: new TargetInput({ input: 'not-json' }),
    }));

    expect(targetPayloadText(Template.fromStack(stack))).toContain('not-json');
  });

  test('rejects subject and message that reuse a path key for different paths', () => {
    const { topic, rule } = createStackWithRule();

    const target = new EventBridgeEmailNotifier(topic, {
      subject: new TopicPathInput(topic, '$.detail.state'),
      message: new TopicPathInput(topic, '$.detail.pipeline'),
    }).bind(rule);

    expect(() => target.input?.bind(rule)).toThrow(/input path key "detail"/);
  });

  test('allows subject and message to reuse a path key for the same path', () => {
    const { stack, topic, rule } = createStackWithRule();

    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: new TopicPathInput(topic, '$.detail.state'),
      message: new TopicPathInput(topic, '$.detail.state'),
    }));

    expect(targetPayloadText(Template.fromStack(stack))).toContain('$.detail.state');
  });

  test('rejects a dead-letter queue in another region', () => {
    const app = new App();
    const stack = new Stack(app, 'Home', {
      env: { account: '111111111111', region: 'us-east-1' },
    });
    const away = new Stack(app, 'Away', {
      env: { account: '111111111111', region: 'eu-west-1' },
    });
    const rule = new events.Rule(stack, 'Rule', {
      eventPattern: { source: ['aws.codepipeline'] },
    });

    expect(() => {
      rule.addTarget(new EventBridgeEmailNotifier(new sns.Topic(stack, 'Topic'), {
        subject: 'Region mismatch',
        deadLetterQueue: new sqs.Queue(away, 'Dlq'),
      }));
    }).toThrow(/same region/);
  });

  test('does not grant the dead-letter queue when the account differs', () => {
    const app = new App();
    const stack = new Stack(app, 'Home', {
      env: { account: '111111111111', region: 'us-east-1' },
    });
    const away = new Stack(app, 'Away', {
      env: { account: '222222222222', region: 'us-east-1' },
    });
    const rule = new events.Rule(stack, 'Rule', {
      eventPattern: { source: ['aws.codepipeline'] },
    });

    rule.addTarget(new EventBridgeEmailNotifier(new sns.Topic(stack, 'Topic'), {
      subject: 'Other account',
      deadLetterQueue: new sqs.Queue(away, 'Dlq', { queueName: 'cross-account-dlq' }),
    }));

    Template.fromStack(stack).hasResourceProperties('AWS::Events::Rule', {
      Targets: Match.arrayWith([
        Match.objectLike({
          DeadLetterConfig: { Arn: Match.anyValue() },
        }),
      ]),
    });
    Template.fromStack(away).resourceCountIs('AWS::SQS::QueuePolicy', 0);
  });

  test('places the publisher in the topic stack when the rule is not a construct', () => {
    const { stack, topic, rule } = createStackWithRule();
    const ruleRef = {
      node: rule.node,
      env: rule.env,
      ruleRef: {
        ruleArn: 'arn:aws:events:us-east-1:123456789012:rule/example',
      },
    } as events.IRuleRef;

    new EventBridgeEmailNotifier(topic, { subject: 'Plain subject' }).bind(ruleRef);

    expect(Object.keys(Template.fromStack(stack).findResources('AWS::Lambda::Function'))).toHaveLength(1);
  });
});

interface SnapshotCase {
  readonly name: string;
  readonly lambdaCount: number;
  readonly arrange: (scope: ReturnType<typeof createStackWithRule>) => void;
  readonly assert: (template: Template) => void;
}

const snapshotCases: readonly SnapshotCase[] = [
  {
    name: 'static subject',
    lambdaCount: 1,
    arrange: ({ topic, rule }) => {
      rule.addTarget(new EventBridgeEmailNotifier(topic, {
        subject: 'Pipeline failed',
        message: events.RuleTargetInput.fromText('Check the pipeline'),
      }));
    },
    assert: (template) => {
      const payload = targetPayloadText(template);
      expect(payload).toContain('Pipeline failed');
      expect(payload).toContain('Check the pipeline');
    },
  },
  {
    name: 'event path subject',
    lambdaCount: 1,
    arrange: ({ topic, rule }) => {
      rule.addTarget(new EventBridgeEmailNotifier(topic, {
        subject: events.EventField.fromPath('$.detail.state'),
      }));
    },
    assert: (template) => {
      const payload = targetPayloadText(template);
      expect(payload).toContain('$.detail.state');
      expect(payload).toContain('<aws.events.event.json>');
    },
  },
  {
    name: 'dead-letter queue and retry',
    lambdaCount: 1,
    arrange: ({ stack, topic, rule }) => {
      rule.addTarget(new EventBridgeEmailNotifier(topic, {
        subject: 'With retries',
        deadLetterQueue: new sqs.Queue(stack, 'Dlq'),
        retryAttempts: 2,
        maxEventAge: Duration.hours(2),
      }));
    },
    assert: (template) => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Targets: Match.arrayWith([
          Match.objectLike({
            DeadLetterConfig: {
              Arn: Match.anyValue(),
            },
            RetryPolicy: {
              MaximumRetryAttempts: 2,
              MaximumEventAgeInSeconds: 7200,
            },
          }),
        ]),
      });
    },
  },
  {
    name: 'distinct subjects',
    lambdaCount: 1,
    arrange: ({ topic, rule }) => {
      rule.addTarget(new EventBridgeEmailNotifier(topic, {
        subject: 'First subject',
        message: events.RuleTargetInput.fromText('first'),
      }));
      rule.addTarget(new EventBridgeEmailNotifier(topic, {
        subject: 'Second subject',
        message: events.RuleTargetInput.fromText('second'),
      }));
    },
    assert: (template) => {
      const targets = ruleTargets(template);
      expect(targets).toHaveLength(2);
      expect(targetFunctionId(targets[0])).toBe(targetFunctionId(targets[1]));
      expect(JSON.stringify(targets[0])).toContain('First subject');
      expect(JSON.stringify(targets[0])).not.toContain('Second subject');
      expect(JSON.stringify(targets[1])).toContain('Second subject');
      expect(JSON.stringify(targets[1])).not.toContain('First subject');
    },
  },
  {
    name: 'reused subject',
    lambdaCount: 1,
    arrange: ({ topic, rule }) => {
      rule.addTarget(new EventBridgeEmailNotifier(topic, {
        subject: 'Same subject',
        message: events.RuleTargetInput.fromText('one'),
      }));
      rule.addTarget(new EventBridgeEmailNotifier(topic, {
        subject: 'Same subject',
        message: events.RuleTargetInput.fromText('two'),
      }));
    },
    assert: (template) => {
      const targets = ruleTargets(template);
      expect(targets).toHaveLength(2);
      expect(targetFunctionId(targets[0])).toBe(targetFunctionId(targets[1]));
      expect(JSON.stringify(targets[0])).toContain('one');
      expect(JSON.stringify(targets[1])).toContain('two');
    },
  },
];

describe('representative synthesized templates', () => {
  test.each(snapshotCases)('$name', ({ name, lambdaCount, arrange, assert }) => {
    const scope = createStackWithRule();
    arrange(scope);
    const template = Template.fromStack(scope.stack);
    expectPublisherWiring(template, lambdaCount);
    assert(template);
    expect(template.toJSON()).toMatchSnapshot(name);
  });
});
