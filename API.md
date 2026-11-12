# API Reference <a name="API Reference" id="api-reference"></a>


## Structs <a name="Structs" id="Structs"></a>

### EventBridgeEmailNotifierProps <a name="EventBridgeEmailNotifierProps" id="eventbridge-email-notifier.EventBridgeEmailNotifierProps"></a>

Properties for {@link EventBridgeEmailNotifier}.

#### Initializer <a name="Initializer" id="eventbridge-email-notifier.EventBridgeEmailNotifierProps.Initializer"></a>

```typescript
import { EventBridgeEmailNotifierProps } from 'eventbridge-email-notifier'

const eventBridgeEmailNotifierProps: EventBridgeEmailNotifierProps = { ... }
```

#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#eventbridge-email-notifier.EventBridgeEmailNotifierProps.property.subject">subject</a></code> | <code>string \| aws-cdk-lib.aws_events.RuleTargetInput</code> | Email subject used when publishing to SNS. |
| <code><a href="#eventbridge-email-notifier.EventBridgeEmailNotifierProps.property.deadLetterQueue">deadLetterQueue</a></code> | <code>aws-cdk-lib.aws_sqs.IQueue</code> | SQS queue used as the EventBridge target dead-letter queue. |
| <code><a href="#eventbridge-email-notifier.EventBridgeEmailNotifierProps.property.maxEventAge">maxEventAge</a></code> | <code>aws-cdk-lib.Duration</code> | Maximum age of an event for EventBridge retries to this target. |
| <code><a href="#eventbridge-email-notifier.EventBridgeEmailNotifierProps.property.message">message</a></code> | <code>aws-cdk-lib.aws_events.RuleTargetInput</code> | Message body published to SNS. |
| <code><a href="#eventbridge-email-notifier.EventBridgeEmailNotifierProps.property.retryAttempts">retryAttempts</a></code> | <code>number</code> | Maximum number of EventBridge retry attempts for this target. |

---

##### `subject`<sup>Required</sup> <a name="subject" id="eventbridge-email-notifier.EventBridgeEmailNotifierProps.property.subject"></a>

```typescript
public readonly subject: string | RuleTargetInput;
```

- *Type:* string | aws-cdk-lib.aws_events.RuleTargetInput

Email subject used when publishing to SNS.

A string is sanitized when the stack is synthesized: control characters
(including newlines) are removed and the value is truncated to
{@link SNS_SUBJECT_MAX_LENGTH} characters.

An event value is sent through the input transformer and sanitized when
the publisher Lambda runs. Use `events.EventField.fromPath('$.detail.state')`
or `events.RuleTargetInput.fromEventPath('$.detail.state')`.
`events.RuleTargetInput.fromText` sets a static subject.
The value that reaches the Lambda must be a string. An object fails that invocation.

---

##### `deadLetterQueue`<sup>Optional</sup> <a name="deadLetterQueue" id="eventbridge-email-notifier.EventBridgeEmailNotifierProps.property.deadLetterQueue"></a>

```typescript
public readonly deadLetterQueue: IQueue;
```

- *Type:* aws-cdk-lib.aws_sqs.IQueue
- *Default:* no dead-letter queue

SQS queue used as the EventBridge target dead-letter queue.

The queue must be in the same region as the rule. In the same account,
EventBridge is granted `sqs:SendMessage` on that queue. A queue in another
account needs that permission on the queue policy.

---

##### `maxEventAge`<sup>Optional</sup> <a name="maxEventAge" id="eventbridge-email-notifier.EventBridgeEmailNotifierProps.property.maxEventAge"></a>

```typescript
public readonly maxEventAge: Duration;
```

- *Type:* aws-cdk-lib.Duration
- *Default:* Duration.hours(24)

Maximum age of an event for EventBridge retries to this target.

---

##### `message`<sup>Optional</sup> <a name="message" id="eventbridge-email-notifier.EventBridgeEmailNotifierProps.property.message"></a>

```typescript
public readonly message: RuleTargetInput;
```

- *Type:* aws-cdk-lib.aws_events.RuleTargetInput
- *Default:* the entire EventBridge event

Message body published to SNS.

The Lambda receives this value as the `message` field and publishes it.
Strings are published as-is. Other values are JSON-serialized.

---

##### `retryAttempts`<sup>Optional</sup> <a name="retryAttempts" id="eventbridge-email-notifier.EventBridgeEmailNotifierProps.property.retryAttempts"></a>

```typescript
public readonly retryAttempts: number;
```

- *Type:* number
- *Default:* 185

Maximum number of EventBridge retry attempts for this target.

---

## Classes <a name="Classes" id="Classes"></a>

### EventBridgeEmailNotifier <a name="EventBridgeEmailNotifier" id="eventbridge-email-notifier.EventBridgeEmailNotifier"></a>

- *Implements:* aws-cdk-lib.aws_events.IRuleTarget

EventBridge rule target that emails via SNS with a custom subject.

EventBridge cannot customize the SNS email subject when SNS is the direct
target (it stays "AWS Notification Message"). This target routes through
Lambda so Publish can set Subject.

The Lambda event is `{ topicArn, subject, message }` built with an input
transformer. Static subjects are checked at synthesis. Subjects taken from
the event are checked on each invocation.

CDK keeps one publisher Lambda per stack for this publisher's uuid.
Every target in that stack invokes it, and the target input carries
that target's topic and subject.

Email subscriptions are not created here; manage them in the console or API.
This target does not change the topic resource policy.

*Example*

```typescript
rule.addTarget(new EventBridgeEmailNotifier(topic, {
  subject: 'Pipeline failed',
  message: events.RuleTargetInput.fromText('Check CodePipeline'),
}));
```


#### Initializers <a name="Initializers" id="eventbridge-email-notifier.EventBridgeEmailNotifier.Initializer"></a>

```typescript
import { EventBridgeEmailNotifier } from 'eventbridge-email-notifier'

new EventBridgeEmailNotifier(topic: ITopic, props: EventBridgeEmailNotifierProps)
```

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#eventbridge-email-notifier.EventBridgeEmailNotifier.Initializer.parameter.topic">topic</a></code> | <code>aws-cdk-lib.aws_sns.ITopic</code> | - SNS topic used for email delivery. |
| <code><a href="#eventbridge-email-notifier.EventBridgeEmailNotifier.Initializer.parameter.props">props</a></code> | <code><a href="#eventbridge-email-notifier.EventBridgeEmailNotifierProps">EventBridgeEmailNotifierProps</a></code> | - Subject, message, and EventBridge retry / DLQ options. |

---

##### `topic`<sup>Required</sup> <a name="topic" id="eventbridge-email-notifier.EventBridgeEmailNotifier.Initializer.parameter.topic"></a>

- *Type:* aws-cdk-lib.aws_sns.ITopic

SNS topic used for email delivery.

---

##### `props`<sup>Required</sup> <a name="props" id="eventbridge-email-notifier.EventBridgeEmailNotifier.Initializer.parameter.props"></a>

- *Type:* <a href="#eventbridge-email-notifier.EventBridgeEmailNotifierProps">EventBridgeEmailNotifierProps</a>

Subject, message, and EventBridge retry / DLQ options.

---

#### Methods <a name="Methods" id="Methods"></a>

| **Name** | **Description** |
| --- | --- |
| <code><a href="#eventbridge-email-notifier.EventBridgeEmailNotifier.bind">bind</a></code> | Bind this notifier as an EventBridge rule target (Lambda → SNS Publish). |

---

##### `bind` <a name="bind" id="eventbridge-email-notifier.EventBridgeEmailNotifier.bind"></a>

```typescript
public bind(rule: IRuleRef, id?: string): RuleTargetConfig
```

Bind this notifier as an EventBridge rule target (Lambda → SNS Publish).

The target input is an object with `topicArn`, `subject`, and `message`.
The publisher Lambda is a CDK singleton function, shared per stack by a
fixed uuid. Each bind declares it under the rule, named after the target
`id`; that declaration does not add a resource.

###### `rule`<sup>Required</sup> <a name="rule" id="eventbridge-email-notifier.EventBridgeEmailNotifier.bind.parameter.rule"></a>

- *Type:* aws-cdk-lib.interfaces.aws_events.IRuleRef

Rule that will invoke the publisher Lambda.

---

###### `id`<sup>Optional</sup> <a name="id" id="eventbridge-email-notifier.EventBridgeEmailNotifier.bind.parameter.id"></a>

- *Type:* string

EventBridge target id from the rule, used to name the publisher declaration.

---





