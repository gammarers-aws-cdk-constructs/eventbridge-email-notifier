import * as iam from 'aws-cdk-lib/aws-iam';
import type * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

/** Marker construct id so the Deny statement is added once per topic. */
const EMAIL_PROTOCOL_RESTRICTION_ID = 'EmailSubscribeProtocolRestriction';

/**
 * Allowed SNS Subscribe protocols for email delivery.
 */
export const EMAIL_SUBSCRIBE_PROTOCOLS = ['email', 'email-json'] as const;

/**
 * Deny sns:Subscribe when the protocol is not email or email-json.
 *
 * `sns:Protocol` is evaluated on Subscribe requests (not on Publish delivery).
 * Calling this more than once for the same topic is a no-op.
 *
 * @param topic - Topic whose resource policy will be updated
 */
export const ensureEmailSubscribeProtocolRestriction = (topic: sns.ITopic): void => {
  if (topic.node.tryFindChild(EMAIL_PROTOCOL_RESTRICTION_ID) !== undefined) {
    return;
  }

  // Marker child records that the restriction was already applied.
  new Construct(topic as unknown as Construct, EMAIL_PROTOCOL_RESTRICTION_ID);

  topic.addToResourcePolicy(new iam.PolicyStatement({
    sid: 'DenySubscribeNonEmailProtocols',
    effect: iam.Effect.DENY,
    principals: [new iam.AnyPrincipal()],
    actions: ['sns:Subscribe'],
    resources: [topic.topicArn],
    conditions: {
      StringNotEquals: {
        'sns:Protocol': [...EMAIL_SUBSCRIBE_PROTOCOLS],
      },
    },
  }));
};
