import { createHash } from 'crypto';
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

const PUBLISHER_CONSTRUCT_ID_PREFIX = 'EventBridgeEmailNotifier';
const PUBLISHER_CONSTRUCT_ID_HASH_LENGTH = 16;

/**
 * EventBridge rule target that emails via SNS with a custom subject.
 *
 * EventBridge cannot customize the SNS email subject when SNS is the direct
 * target (it stays "AWS Notification Message"). This target routes through
 * Lambda so Publish can set Subject, and always restricts topic Subscribe
 * protocols to email / email-json.
 *
 * On a given rule, publisher Lambdas are keyed by topic ARN + sanitized
 * subject: identical pairs reuse one function; different pairs never share.
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
   * Publisher construct ids are derived from topic ARN + sanitized subject so
   * multiple targets on the same rule do not reuse a Lambda with a different
   * subject or topic. The EventBridge target `id` is accepted for
   * {@link events.IRuleTarget} compatibility and is not used for the construct id.
   *
   * @param rule - Rule that will invoke the publisher Lambda
   * @param _id - EventBridge target id from the rule (unused for construct ids)
   * @returns Rule target configuration including retry / DLQ settings
   */
  public bind(rule: events.IRuleRef, _id?: string): events.RuleTargetConfig {
    const scope = resolveBindScope(rule, this.topic);
    const constructId = publisherConstructId(
      this.topic.topicArn,
      this.sanitizedSubject,
    );

    const existing = scope.node.tryFindChild(constructId);
    const handler = existing instanceof lambda.Function
      ? reusePublisherFunction(
        existing,
        this.topic.topicArn,
        this.sanitizedSubject,
      )
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

    // Marker keeps unresolved tokens so reuse can compare without resolve().
    new PublisherConfigMarker(handler, this.topic.topicArn, this.sanitizedSubject);
    this.topic.grantPublish(handler);
    return handler;
  }
}

/**
 * Stable construct id so the same topic+subject pair can share a Lambda.
 */
const publisherConstructId = (topicArn: string, subject: string): string => {
  const digest = createHash('sha256')
    .update(topicArn)
    .update('\0')
    .update(subject)
    .digest('hex')
    .slice(0, PUBLISHER_CONSTRUCT_ID_HASH_LENGTH);

  return `${PUBLISHER_CONSTRUCT_ID_PREFIX}${digest}`;
};

/**
 * Reuse an existing publisher only when the stored topic ARN and subject match.
 */
const reusePublisherFunction = (
  existing: lambda.Function,
  topicArn: string,
  subject: string,
): lambda.Function => {
  const marker = existing.node.tryFindChild(PUBLISHER_CONFIG_MARKER_ID);
  if (!(marker instanceof PublisherConfigMarker)) {
    throw new Error(
      `Cannot reuse construct "${existing.node.id}": missing EventBridgeEmailNotifier config marker`,
    );
  }

  if (marker.subject !== subject) {
    throw new Error(
      `Cannot reuse EventBridgeEmailNotifier Lambda "${existing.node.id}": ` +
      `subject mismatch (existing=${JSON.stringify(marker.subject)}, requested=${JSON.stringify(subject)})`,
    );
  }

  if (Token.compareStrings(marker.topicArn, topicArn) === TokenComparison.DIFFERENT) {
    throw new Error(
      `Cannot reuse EventBridgeEmailNotifier Lambda "${existing.node.id}": ` +
      `topic ARN mismatch (existing=${JSON.stringify(marker.topicArn)}, requested=${JSON.stringify(topicArn)})`,
    );
  }

  return existing;
};

const PUBLISHER_CONFIG_MARKER_ID = 'PublisherConfig';

/**
 * Stores publisher config on the Lambda so reuse checks work with Tokens.
 */
class PublisherConfigMarker extends Construct {
  public readonly topicArn: string;
  public readonly subject: string;

  constructor(scope: Construct, topicArn: string, subject: string) {
    super(scope, PUBLISHER_CONFIG_MARKER_ID);
    this.topicArn = topicArn;
    this.subject = subject;
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
