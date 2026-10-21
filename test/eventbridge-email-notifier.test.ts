import { App, Duration, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as events from 'aws-cdk-lib/aws-events';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { EventBridgeEmailNotifier } from '../src';
import { SUBJECT_ENV, TOPIC_ARN_ENV } from '../src/core/sns-publish-env';

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

describe('EventBridgeEmailNotifier', () => {
  test('routes EventBridge through Lambda to SNS with custom subject', () => {
    const { stack, topic, rule } = createStackWithRule();

    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: 'Pipeline failed',
      message: events.RuleTargetInput.fromText('Check the pipeline'),
    }));

    const template = Template.fromStack(stack);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Handler: 'index.handler',
      Code: {
        ZipFile: Match.absent(),
      },
      Environment: {
        Variables: {
          [SUBJECT_ENV]: 'Pipeline failed',
          [TOPIC_ARN_ENV]: Match.anyValue(),
        },
      },
    });

    template.hasResourceProperties('AWS::Events::Rule', {
      Targets: Match.arrayWith([
        Match.objectLike({
          Input: '"Check the pipeline"',
          Arn: Match.objectLike({
            'Fn::GetAtt': Match.arrayWith([
              Match.stringLikeRegexp('.*EventBridgeEmailNotifier.*'),
              'Arn',
            ]),
          }),
        }),
      ]),
    });

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

  test('sanitizes subject for SNS constraints', () => {
    const { stack, topic, rule } = createStackWithRule();

    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: `Alert\n${'x'.repeat(120)}`,
    }));

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          [SUBJECT_ENV]: `Alert${'x'.repeat(94)}`,
        },
      },
    });
  });

  test('rejects subject that becomes empty after sanitization', () => {
    const { topic } = createStackWithRule();

    expect(() => {
      new EventBridgeEmailNotifier(topic, {
        subject: '\n\r\t',
      });
    }).toThrow(/non-control character/);
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
    const lambdas = template.findResources('AWS::Lambda::Function');
    const subjects = Object.values(lambdas)
      .map((resource) => resource.Properties?.Environment?.Variables?.[SUBJECT_ENV])
      .filter((subject): subject is string => typeof subject === 'string')
      .sort();

    expect(subjects).toEqual(['First subject', 'Second subject']);

    template.hasResourceProperties('AWS::Events::Rule', {
      Targets: Match.arrayWith([
        Match.objectLike({
          Input: '"first"',
        }),
        Match.objectLike({
          Input: '"second"',
        }),
      ]),
    });
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
    const lambdas = template.findResources('AWS::Lambda::Function');
    const publisherSubjects = Object.values(lambdas)
      .map((resource) => resource.Properties?.Environment?.Variables?.[SUBJECT_ENV])
      .filter((subject) => subject === 'Same subject');

    expect(publisherSubjects).toHaveLength(1);

    template.resourceCountIs('AWS::Events::Rule', 1);
    template.hasResourceProperties('AWS::Events::Rule', {
      Targets: Match.arrayWith([
        Match.objectLike({ Input: '"one"' }),
        Match.objectLike({ Input: '"two"' }),
      ]),
    });
  });

  test('creates distinct Lambdas when bind is called without an id', () => {
    const { stack, topic, rule } = createStackWithRule();

    new EventBridgeEmailNotifier(topic, { subject: 'Alpha' }).bind(rule);
    new EventBridgeEmailNotifier(topic, { subject: 'Beta' }).bind(rule);

    const template = Template.fromStack(stack);
    const subjects = Object.values(template.findResources('AWS::Lambda::Function'))
      .map((resource) => resource.Properties?.Environment?.Variables?.[SUBJECT_ENV])
      .filter((subject): subject is string => typeof subject === 'string')
      .sort();

    expect(subjects).toEqual(['Alpha', 'Beta']);
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
});
