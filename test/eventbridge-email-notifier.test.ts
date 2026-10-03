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

  test('always denies non-email Subscribe protocols on the topic', () => {
    const { stack, topic, rule } = createStackWithRule();

    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: 'Hello',
    }));

    // Second target must not duplicate the restriction marker / break synthesis.
    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: 'Hello again',
    }));

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::SNS::TopicPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Sid: 'DenySubscribeNonEmailProtocols',
            Effect: 'Deny',
            Action: 'sns:Subscribe',
            Condition: {
              StringNotEquals: {
                'sns:Protocol': ['email', 'email-json'],
              },
            },
          }),
        ]),
      },
    });
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
