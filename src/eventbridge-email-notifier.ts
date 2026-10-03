import { Duration, Names, Stack, Token, TokenComparison } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import type * as sns from 'aws-cdk-lib/aws-sns';
import type * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { ensureEmailSubscribeProtocolRestriction } from './core/email-subscribe-topic-policy';
import type { EventBridgeEmailNotifierProps } from './core/eventbridge-email-notifier-props';
import { SUBJECT_ENV, TOPIC_ARN_ENV } from './core/sns-publish-env';
import { sanitizeSnsSubject } from './core/sns-subject';
import { SnsPublishFunction } from './funcs/sns-publish-function';

/**
 * EventBridge rule target that emails via SNS with a custom subject.
 *
 * EventBridge cannot customize the SNS email subject when SNS is the direct
 * target (it stays "AWS Notification Message"). This target routes through
 * Lambda so Publish can set Subject, and always restricts topic Subscribe
 * protocols to email / email-json.
 *
 * Email subscriptions are not created here; manage them in the console or API.
 *
 * @example
 * rule.addTarget(new EventBridgeEmailNotifier(topic, {
 *   subject: 'Pipeline failed',
 *   message: events.RuleTargetInput.fromText('Check CodePipeline'),
 * }));
 */
export class EventBridgeEmailNotifier implements events.IRuleTarget {
  private readonly topic: sns.ITopic;
  private readonly props: EventBridgeEmailNotifierProps;
  private readonly sanitizedSubject: string;

  /**
   * @param topic - SNS topic used for email delivery
   * @param props - Subject, message, and EventBridge retry / DLQ options
   */
  constructor(topic: sns.ITopic, props: EventBridgeEmailNotifierProps) {
    this.topic = topic;
    this.props = props;

    const sanitized = sanitizeSnsSubject(props.subject);
    if (sanitized.length === 0) {
      throw new Error(
        'subject must contain at least one non-control character after sanitization',
      );
    }
    this.sanitizedSubject = sanitized;

    // Restrict Subscribe protocols as soon as the target is constructed.
    ensureEmailSubscribeProtocolRestriction(topic);
  }

  /**
   * Bind this notifier as an EventBridge rule target (Lambda → SNS Publish).
   *
   * @param rule - Rule that will invoke the publisher Lambda
   * @param id - Optional target id used for construct ids
   * @returns Rule target configuration including retry / DLQ settings
   */
  public bind(rule: events.IRuleRef, id?: string): events.RuleTargetConfig {
    const scope = resolveBindScope(rule, this.topic);
    const constructId = id === undefined
      ? 'EventBridgeEmailNotifier'
      : `EventBridgeEmailNotifier${id}`;

    const existing = scope.node.tryFindChild(constructId);
    const handler = existing instanceof lambda.Function
      ? existing
      : this.createPublisherFunction(scope, constructId);

    addLambdaInvokePermission(rule, handler);

    if (this.props.deadLetterQueue !== undefined) {
      addDeadLetterQueuePolicy(rule, this.props.deadLetterQueue);
    }

    return {
      ...bindRetryAndDlqConfig(this.props),
      arn: handler.functionArn,
      input: this.props.message,
      targetResource: handler,
    };
  }

  private createPublisherFunction(scope: Construct, id: string): lambda.Function {
    const handler = new SnsPublishFunction(scope, id, {
      description: 'Publish EventBridge events to SNS with a custom email subject',
      timeout: Duration.seconds(30),
      environment: {
        [TOPIC_ARN_ENV]: this.topic.topicArn,
        [SUBJECT_ENV]: this.sanitizedSubject,
      },
    });

    this.topic.grantPublish(handler);
    return handler;
  }
}

/**
 * Prefer the rule construct as scope so resources nest under the rule.
 */
const resolveBindScope = (rule: events.IRuleRef, topic: sns.ITopic): Construct => {
  if (Construct.isConstruct(rule)) {
    return rule;
  }

  return Stack.of(topic);
};

/**
 * Allow EventBridge to invoke the publisher Lambda for this rule.
 */
const addLambdaInvokePermission = (
  rule: events.IRuleRef,
  handler: lambda.IFunction,
): void => {
  let scope: Construct | undefined;
  let node = handler.permissionsNode;
  let permissionId = `AllowEventRule${Names.nodeUniqueId(rule.node)}`;

  if (rule instanceof Construct) {
    scope = rule;
    node = rule.node;
    permissionId = `AllowEventRule${Names.nodeUniqueId(handler.node)}`;
  }

  if (node.tryFindChild(permissionId) !== undefined) {
    return;
  }

  handler.addPermission(permissionId, {
    scope,
    action: 'lambda:InvokeFunction',
    principal: new iam.ServicePrincipal('events.amazonaws.com'),
    sourceArn: events.CfnRule.arnForRule(rule),
  });
};

/**
 * Allow EventBridge to send failed invocations to the DLQ when same-account.
 */
const addDeadLetterQueuePolicy = (rule: events.IRuleRef, queue: sqs.IQueue): void => {
  if (!sameEnvDimension(rule.env.region, queue.env.region)) {
    throw new Error(
      `Cannot assign Dead Letter Queue in region ${queue.env.region} to the rule ` +
      `${Names.nodeUniqueId(rule.node)} in region ${rule.env.region}. ` +
      'Both the queue and the rule must be in the same region.',
    );
  }

  if (!sameEnvDimension(rule.env.account, queue.env.account)) {
    return;
  }

  const policyStatementId = `AllowEventRule${Names.nodeUniqueId(rule.node)}`;
  queue.addToResourcePolicy(new iam.PolicyStatement({
    sid: policyStatementId,
    principals: [new iam.ServicePrincipal('events.amazonaws.com')],
    effect: iam.Effect.ALLOW,
    actions: ['sqs:SendMessage'],
    resources: [queue.queueArn],
    conditions: {
      ArnEquals: {
        'aws:SourceArn': events.CfnRule.arnForRule(rule),
      },
    },
  }));
};

/**
 * Map DLQ / retry props onto RuleTargetConfig fields.
 */
const bindRetryAndDlqConfig = (
  props: EventBridgeEmailNotifierProps,
): Pick<events.RuleTargetConfig, 'deadLetterConfig' | 'retryPolicy'> => {
  const { deadLetterQueue, retryAttempts, maxEventAge } = props;
  const hasRetryPolicy = (retryAttempts !== undefined && retryAttempts >= 0)
    || maxEventAge !== undefined;

  return {
    deadLetterConfig: deadLetterQueue === undefined
      ? undefined
      : { arn: deadLetterQueue.queueArn },
    retryPolicy: hasRetryPolicy
      ? {
        maximumRetryAttempts: retryAttempts,
        maximumEventAgeInSeconds: maxEventAge?.toSeconds({ integral: true }),
      }
      : undefined,
  };
};

const sameEnvDimension = (dim1: string, dim2: string): boolean => {
  const comparison = Token.compareStrings(dim1, dim2);
  return comparison === TokenComparison.SAME
    || comparison === TokenComparison.ONE_UNRESOLVED
    || comparison === TokenComparison.BOTH_UNRESOLVED;
};
