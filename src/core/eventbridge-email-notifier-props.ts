import type { Duration } from 'aws-cdk-lib';
import type * as events from 'aws-cdk-lib/aws-events';
import type * as sqs from 'aws-cdk-lib/aws-sqs';

/**
 * Properties for {@link EventBridgeEmailNotifier}.
 */
export interface EventBridgeEmailNotifierProps {
  /**
   * Email subject used when publishing to SNS.
   *
   * Control characters (including newlines) are removed and the value is
   * truncated to 99 characters to satisfy SNS Publish constraints.
   */
  readonly subject: string;

  /**
   * Message body sent to the Lambda target (then published to SNS).
   *
   * @default the entire EventBridge event (JSON-serialized)
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
