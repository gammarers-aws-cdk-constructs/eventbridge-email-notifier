import { Duration, Names, Stack, Token, TokenComparison, Tokenization } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import type * as sns from 'aws-cdk-lib/aws-sns';
import type * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { SnsPublishFunction } from './funcs/sns-publish-function';
import {
  PUBLISH_MESSAGE_FIELD,
  PUBLISH_SUBJECT_FIELD,
  PUBLISH_TOPIC_ARN_FIELD,
  PUBLISHER_TIMEOUT_SECONDS,
  SNS_SUBJECT_MAX_LENGTH,
} from './settings/consts';

const PUBLISHER_FUNCTION_ID = 'EventBridgeEmailNotifierFunction';

/**
 * EventBridge predefined variable for the full event JSON.
 * Valid only as a JSON value inside an input template.
 */
const EVENT_JSON_VARIABLE = '<aws.events.event.json>';

/** Control characters forbidden in SNS Subject (line breaks and other Cc). */
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Properties for {@link EventBridgeEmailNotifier}.
 */
export interface EventBridgeEmailNotifierProps {
  /**
   * Email subject used when publishing to SNS.
   *
   * A string is sanitized when the stack is synthesized: control characters
   * (including newlines) are removed and the value is truncated to
   * {@link SNS_SUBJECT_MAX_LENGTH} characters.
   *
   * An event value is sent through the input transformer and sanitized when
   * the publisher Lambda runs. Use `events.EventField.fromPath('$.detail.state')`
   * or `events.RuleTargetInput.fromEventPath('$.detail.state')`.
   * `events.RuleTargetInput.fromText` sets a static subject.
   * The value that reaches the Lambda must be a string. An object fails that invocation.
   */
  readonly subject: string | events.RuleTargetInput;

  /**
   * Message body published to SNS.
   *
   * The Lambda receives this value as the `message` field and publishes it.
   * Strings are published as-is. Other values are JSON-serialized.
   *
   * @default the entire EventBridge event
   */
  readonly message?: events.RuleTargetInput;

  /**
   * SQS queue used as the EventBridge target dead-letter queue.
   *
   * @default - no dead-letter queue
   */
  readonly deadLetterQueue?: sqs.IQueue;

  /**
   * Maximum age of an event for EventBridge retries to this target.
   *
   * @default Duration.hours(24)
   */
  readonly maxEventAge?: Duration;

  /**
   * Maximum number of EventBridge retry attempts for this target.
   *
   * @default 185
   */
  readonly retryAttempts?: number;
}

/**
 * Sanitize a string for use as an SNS email Subject.
 *
 * Removes control characters (including newlines) and truncates to
 * {@link SNS_SUBJECT_MAX_LENGTH} characters.
 *
 * @param subject - Candidate subject text
 * @returns Sanitized subject safe for SNS Publish
 */
export const sanitizeSnsSubject = (subject: string): string => {
  const withoutControls = subject.replace(CONTROL_CHARACTER_PATTERN, '');
  return withoutControls.slice(0, SNS_SUBJECT_MAX_LENGTH);
};

/**
 * EventBridge rule target that emails via SNS with a custom subject.
 *
 * EventBridge cannot customize the SNS email subject when SNS is the direct
 * target (it stays "AWS Notification Message"). This target routes through
 * Lambda so Publish can set Subject.
 *
 * The Lambda event is `{ topicArn, subject, message }` built with an input
 * transformer. Static subjects are checked at synthesis. Subjects taken from
 * the event are checked on each invocation.
 *
 * One publisher Lambda is created per stack. Every target in that stack
 * invokes it, and the target input carries that target's topic and subject.
 *
 * Email subscriptions are not created here; manage them in the console or API.
 * This target does not change the topic resource policy.
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

  /**
   * @param topic - SNS topic used for email delivery
   * @param props - Subject, message, and EventBridge retry / DLQ options
   * @throws Error when a string subject is empty after sanitization, or is an unresolved token that is not an event path
   */
  constructor(topic: sns.ITopic, props: EventBridgeEmailNotifierProps) {
    this.topic = topic;
    this.props = props;
    ensureSubjectAtConstruction(props.subject);
  }

  /**
   * Bind this notifier as an EventBridge rule target (Lambda → SNS Publish).
   *
   * The target input is an object with `topicArn`, `subject`, and `message`.
   * The publisher Lambda is a single function on the stack. The EventBridge
   * target `id` is accepted for {@link events.IRuleTarget} compatibility and
   * is not used to identify the function.
   *
   * @param rule - Rule that will invoke the publisher Lambda
   * @param _id - EventBridge target id from the rule (unused for construct ids)
   * @returns Rule target configuration including retry / DLQ settings
   * @throws Error when a static `RuleTargetInput` subject is empty after sanitization
   */
  public bind(rule: events.IRuleRef, _id?: string): events.RuleTargetConfig {
    const subject = resolveSubject(rule, this.topic, this.props.subject);
    const handler = publisherFunction(resolutionStack(rule, this.topic));
    grantTopicPublish(handler, this.topic);
    addLambdaInvokePermission(rule, handler);

    if (this.props.deadLetterQueue !== undefined) {
      addDeadLetterQueuePolicy(rule, this.props.deadLetterQueue);
    }

    return {
      ...bindRetryAndDlqConfig(this.props),
      arn: handler.functionArn,
      input: new PublisherEventInput(this.topic, subject, this.props.message),
      targetResource: handler,
    };
  }
}

interface InputFragment {
  readonly json: string;
  readonly paths: { [key: string]: string };
}

/**
 * Target input `{ topicArn, subject, message }` for the publisher Lambda.
 */
class PublisherEventInput extends events.RuleTargetInput {
  private readonly topic: sns.ITopic;
  private readonly subject: events.RuleTargetInput;
  private readonly message: events.RuleTargetInput | undefined;

  constructor(
    topic: sns.ITopic,
    subject: events.RuleTargetInput,
    message: events.RuleTargetInput | undefined,
  ) {
    super();
    this.topic = topic;
    this.subject = subject;
    this.message = message;
  }

  public bind(rule: events.IRuleRef): events.RuleTargetInputProperties {
    return bindPublisherInput(rule, this.topic, this.subject, this.message);
  }
}

/**
 * Reject string subjects that cannot be checked at construction.
 */
const ensureSubjectAtConstruction = (subject: string | events.RuleTargetInput): void => {
  if (typeof subject !== 'string') {
    return;
  }

  if (eventFieldPath(subject) !== undefined) {
    return;
  }

  ensureStaticSubject(subject);
};

/**
 * Reject unresolved tokens and subjects that sanitize to empty.
 */
const ensureStaticSubject = (subject: string): void => {
  if (Token.isUnresolved(subject)) {
    throw new Error('subject must be a string or an event path');
  }

  if (sanitizeSnsSubject(subject).length === 0) {
    throw new Error(
      'subject must contain at least one non-control character after sanitization',
    );
  }
};

/**
 * Event path stored inside an `EventField.fromPath` token, if this string is one.
 */
const eventFieldPath = (value: string): string | undefined => {
  const resolvable = Tokenization.reverse(value, { failConcat: false });
  if (!(resolvable instanceof events.EventField)) {
    return undefined;
  }

  return resolvable.path;
};

const textSubject = (subject: string): events.RuleTargetInput => {
  const sanitized = sanitizeSnsSubject(subject);
  if (sanitized.length === 0) {
    throw new Error(
      'subject must contain at least one non-control character after sanitization',
    );
  }

  return events.RuleTargetInput.fromText(sanitized);
};

const pathSubject = (path: string): events.RuleTargetInput => {
  return events.RuleTargetInput.fromEventPath(path);
};

/**
 * Normalize a subject to a `RuleTargetInput`.
 *
 * Plain strings and static text are sanitized here. A single event path stays
 * a path so the Lambda sees the value extracted at delivery time.
 */
const resolveSubject = (
  rule: events.IRuleRef,
  topic: sns.ITopic,
  subject: string | events.RuleTargetInput,
): events.RuleTargetInput => {
  if (typeof subject === 'string') {
    const path = eventFieldPath(subject);
    if (path !== undefined) {
      return pathSubject(path);
    }

    ensureStaticSubject(subject);
    return textSubject(subject);
  }

  const stack = resolutionStack(rule, topic);
  const bound = subject.bind(rule);

  if (bound.inputPath !== undefined) {
    return pathSubject(bound.inputPath);
  }

  const materializedInput = materializeInput(stack, bound.input);
  const pathCount = Object.keys(bound.inputPathsMap ?? {}).length;
  if (materializedInput !== undefined && !Token.isUnresolved(materializedInput) && pathCount === 0) {
    const parsed = parseJsonValue(materializedInput);
    if (typeof parsed === 'string') {
      return textSubject(parsed);
    }
  }

  const materializedTemplate = materializeInput(stack, bound.inputTemplate);
  const lonePath = loneEventPath(bound.inputPathsMap, materializedTemplate);
  if (lonePath !== undefined) {
    return pathSubject(lonePath);
  }

  return subject;
};

/**
 * One event path when the template is only that placeholder.
 */
const loneEventPath = (
  paths: { [key: string]: string } | undefined,
  template: string | undefined,
): string | undefined => {
  if (paths === undefined || template === undefined || Token.isUnresolved(template)) {
    return undefined;
  }

  const keys = Object.keys(paths);
  if (keys.length !== 1) {
    return undefined;
  }

  const key = keys[0];
  if (template !== `<${key}>` && template !== `"<${key}>"`) {
    return undefined;
  }

  return paths[key];
};

/**
 * Build the publisher event. Path values stay unquoted so EventBridge can
 * quote strings and embed objects. Literal text is already JSON.
 */
const bindPublisherInput = (
  rule: events.IRuleRef,
  topic: sns.ITopic,
  subject: events.RuleTargetInput,
  message: events.RuleTargetInput | undefined,
): events.RuleTargetInputProperties => {
  const stack = resolutionStack(rule, topic);
  const subjectFragment = sanitizeConstantSubjectFragment(
    bindInputFragment(rule, stack, subject, PUBLISH_SUBJECT_FIELD),
  );
  const messageFragment = message === undefined
    ? { json: EVENT_JSON_VARIABLE, paths: {} }
    : bindInputFragment(rule, stack, message, PUBLISH_MESSAGE_FIELD);
  const topicJson = stack.toJsonString(topic.topicArn);
  const envelope = [
    `{"${PUBLISH_TOPIC_ARN_FIELD}":${topicJson}`,
    `"${PUBLISH_SUBJECT_FIELD}":${subjectFragment.json}`,
    `"${PUBLISH_MESSAGE_FIELD}":${messageFragment.json}}`,
  ].join(',');
  const inputPathsMap = mergePathMaps(subjectFragment.paths, messageFragment.paths);

  if (!fragmentNeedsTemplate(subjectFragment) && !fragmentNeedsTemplate(messageFragment)) {
    return { input: envelope };
  }

  if (Object.keys(inputPathsMap).length === 0) {
    return { inputTemplate: envelope };
  }

  return {
    inputTemplate: envelope,
    inputPathsMap,
  };
};

const bindInputFragment = (
  rule: events.IRuleRef,
  stack: Stack,
  input: events.RuleTargetInput,
  fieldName: string,
): InputFragment => {
  const bound = input.bind(rule);

  if (bound.inputPath !== undefined) {
    return {
      json: `<${fieldName}>`,
      paths: { [fieldName]: bound.inputPath },
    };
  }

  const materializedInput = materializeInput(stack, bound.input);
  const pathCount = Object.keys(bound.inputPathsMap ?? {}).length;
  if (materializedInput !== undefined && !Token.isUnresolved(materializedInput) && pathCount === 0) {
    return { json: materializedInput, paths: {} };
  }

  const template = materializeInput(stack, bound.inputTemplate) ?? materializedInput;
  if (template === undefined) {
    throw new Error(`${fieldName} must be text, an event path, or an object input`);
  }

  return prefixResolvedPathKeys(template, bound.inputPathsMap ?? {}, `${fieldName}_`);
};

/**
 * Re-sanitize static JSON strings. Path-based subjects are sanitized at runtime.
 */
const sanitizeConstantSubjectFragment = (fragment: InputFragment): InputFragment => {
  if (Object.keys(fragment.paths).length > 0 || Token.isUnresolved(fragment.json)) {
    return fragment;
  }

  const parsed = parseJsonValue(fragment.json);
  if (typeof parsed !== 'string') {
    return fragment;
  }

  return {
    json: JSON.stringify(sanitizeSnsSubject(parsed)),
    paths: {},
  };
};

const prefixResolvedPathKeys = (
  template: string,
  paths: { [key: string]: string },
  prefix: string,
): InputFragment => {
  const keys = Object.keys(paths).sort((left, right) => right.length - left.length);
  if (keys.length === 0 || Token.isUnresolved(template)) {
    return { json: template, paths };
  }

  const prefixed: { [key: string]: string } = {};
  for (const key of keys) {
    prefixed[`${prefix}${key}`] = paths[key];
  }

  return {
    json: replacePlaceholderKeys(template, keys, prefix),
    paths: prefixed,
  };
};

const replacePlaceholderKeys = (
  template: string,
  keys: readonly string[],
  prefix: string,
): string => {
  return keys.reduce((current, key) => {
    return current.split(`<${key}>`).join(`<${prefix}${key}>`);
  }, template);
};

const fragmentNeedsTemplate = (fragment: InputFragment): boolean => {
  if (Object.keys(fragment.paths).length > 0) {
    return true;
  }

  return fragment.json.includes('<');
};

const mergePathMaps = (
  subjectPaths: { [key: string]: string },
  messagePaths: { [key: string]: string },
): { [key: string]: string } => {
  for (const key of Object.keys(messagePaths)) {
    const existing = subjectPaths[key];
    if (existing !== undefined && existing !== messagePaths[key]) {
      throw new Error(`subject and message use the same input path key "${key}"`);
    }
  }

  return {
    ...subjectPaths,
    ...messagePaths,
  };
};

/**
 * Resolve input JSON to a string when CloudFormation intrinsics are not required.
 */
const materializeInput = (stack: Stack, value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (!Token.isUnresolved(value)) {
    return value;
  }

  const resolved = stack.resolve(value);
  if (typeof resolved !== 'string') {
    return value;
  }

  return resolved;
};

const parseJsonValue = (json: string): unknown => {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
};

const resolutionStack = (rule: events.IRuleRef, topic: sns.ITopic): Stack => {
  if (Construct.isConstruct(rule)) {
    return Stack.of(rule);
  }

  return Stack.of(topic);
};

const grantedTopicArns = new WeakMap<lambda.IFunction, Set<string>>();

/**
 * One publisher for the stack. Topic and subject travel in each target input.
 */
const publisherFunction = (stack: Stack): lambda.Function => {
  const existing = stack.node.tryFindChild(PUBLISHER_FUNCTION_ID);
  if (existing instanceof SnsPublishFunction) {
    return existing;
  }

  if (existing !== undefined) {
    throw new Error(
      `Cannot create the EventBridge email publisher: "${PUBLISHER_FUNCTION_ID}" already exists on this stack`,
    );
  }

  return new SnsPublishFunction(stack, PUBLISHER_FUNCTION_ID, {
    description: 'Publish EventBridge events to SNS with a custom email subject',
    timeout: Duration.seconds(PUBLISHER_TIMEOUT_SECONDS),
  });
};

/**
 * Grant sns:Publish once per topic. The singleton role accumulates one statement per topic.
 */
const grantTopicPublish = (handler: lambda.IFunction, topic: sns.ITopic): void => {
  const granted = grantedTopicArns.get(handler) ?? new Set<string>();
  grantedTopicArns.set(handler, granted);
  if (granted.has(topic.topicArn)) {
    return;
  }

  granted.add(topic.topicArn);
  topic.grantPublish(handler);
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
