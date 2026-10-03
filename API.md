# API Reference <a name="API Reference" id="api-reference"></a>


## Structs <a name="Structs" id="Structs"></a>

### EventBridgeEmailNotifierProps <a name="EventBridgeEmailNotifierProps" id="eventbridge-email-notifier.EventBridgeEmailNotifierProps"></a>

Properties for {@link EventBridgeEmailNotifier }.

#### Initializer <a name="Initializer" id="eventbridge-email-notifier.EventBridgeEmailNotifierProps.Initializer"></a>

```typescript
import { EventBridgeEmailNotifierProps } from 'eventbridge-email-notifier'

const eventBridgeEmailNotifierProps: EventBridgeEmailNotifierProps = { ... }
```

#### Properties <a name="Properties" id="Properties"></a>

| **Name** | **Type** | **Description** |
| --- | --- | --- |
| <code><a href="#eventbridge-email-notifier.EventBridgeEmailNotifierProps.property.subject">subject</a></code> | <code>string</code> | Email subject used when publishing to SNS. |
| <code><a href="#eventbridge-email-notifier.EventBridgeEmailNotifierProps.property.deadLetterQueue">deadLetterQueue</a></code> | <code>aws-cdk-lib.aws_sqs.IQueue</code> | SQS queue used as the EventBridge target dead-letter queue. |
| <code><a href="#eventbridge-email-notifier.EventBridgeEmailNotifierProps.property.maxEventAge">maxEventAge</a></code> | <code>aws-cdk-lib.Duration</code> | Maximum age of an event for EventBridge retries to this target. |
| <code><a href="#eventbridge-email-notifier.EventBridgeEmailNotifierProps.property.message">message</a></code> | <code>aws-cdk-lib.aws_events.RuleTargetInput</code> | Message body sent to the Lambda target (then published to SNS). |
| <code><a href="#eventbridge-email-notifier.EventBridgeEmailNotifierProps.property.retryAttempts">retryAttempts</a></code> | <code>number</code> | Maximum number of EventBridge retry attempts for this target. |

---

##### `subject`<sup>Required</sup> <a name="subject" id="eventbridge-email-notifier.EventBridgeEmailNotifierProps.property.subject"></a>

```typescript
public readonly subject: string;
```

- *Type:* string

Email subject used when publishing to SNS.

Control characters (including newlines) are removed and the value is
truncated to 99 characters to satisfy SNS Publish constraints.

---

##### `deadLetterQueue`<sup>Optional</sup> <a name="deadLetterQueue" id="eventbridge-email-notifier.EventBridgeEmailNotifierProps.property.deadLetterQueue"></a>

```typescript
public readonly deadLetterQueue: IQueue;
```

- *Type:* aws-cdk-lib.aws_sqs.IQueue
- *Default:* no dead-letter queue

SQS queue used as the EventBridge target dead-letter queue.

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
- *Default:* the entire EventBridge event (JSON-serialized)

Message body sent to the Lambda target (then published to SNS).

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
Lambda so Publish can set Subject, and always restricts topic Subscribe
protocols to email / email-json.

Email subscriptions are not created here; manage them in the console or API.

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

###### `rule`<sup>Required</sup> <a name="rule" id="eventbridge-email-notifier.EventBridgeEmailNotifier.bind.parameter.rule"></a>

- *Type:* aws-cdk-lib.interfaces.aws_events.IRuleRef

Rule that will invoke the publisher Lambda.

---

###### `id`<sup>Optional</sup> <a name="id" id="eventbridge-email-notifier.EventBridgeEmailNotifier.bind.parameter.id"></a>

- *Type:* string

Optional target id used for construct ids.

---





