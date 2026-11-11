# EventBridge Email Notifier (CDK v2)

[![npm version](https://img.shields.io/npm/v/eventbridge-email-notifier?style=flat-square)](https://www.npmjs.com/package/eventbridge-email-notifier)
[![license](https://img.shields.io/npm/l/eventbridge-email-notifier?style=flat-square)](https://www.npmjs.com/package/eventbridge-email-notifier)
[![Node.js](https://img.shields.io/node/v/eventbridge-email-notifier?style=flat-square)](https://www.npmjs.com/package/eventbridge-email-notifier)
[![build](https://img.shields.io/github/actions/workflow/status/gammarers-aws-cdk-constructs/eventbridge-email-notifier/build.yml?label=build&style=flat-square)](https://github.com/gammarers-aws-cdk-constructs/eventbridge-email-notifier/actions/workflows/build.yml)

[![View on Construct Hub](https://constructs.dev/badge?package=eventbridge-email-notifier)](https://constructs.dev/packages/eventbridge-email-notifier)

EventBridge rule target that sends email through Amazon SNS with a custom subject.
The subject can be a fixed string or a value taken from the event, such as a pipeline state.

## Features

- Plug into an existing EventBridge rule via `rule.addTarget(...)`
- Custom SNS email subject (EventBridge cannot set subject when SNS is a direct target)
- Subject from a string, an event path (`$.detail.state`), or `RuleTargetInput`
- Subject sanitization for SNS Publish limits (control characters removed, max 99 chars)
- EventBridge target dead-letter queue and retry settings

## How it works

EventBridge invokes a small Lambda publisher with an input object of `topicArn`, `subject`, and `message`. The Lambda removes control characters from the subject, truncates it to 99 characters, and calls SNS `Publish` with that subject and message. A string subject is checked when the stack is synthesized. A subject taken from the event is checked on each invocation, and an empty result fails that invocation.

On the same rule, targets that share a topic and the same subject specification reuse one publisher Lambda. The specification is the sanitized text or the event path. Different specifications or topics get separate functions. Email subscriptions are not created by this library, and the topic resource policy is not modified—add subscriptions in the console or API when addresses change.

The publisher Lambda timeout is 30 seconds and is not configurable via props today. SNS client retries use the SDK attempt budget (`maxAttempts` 3).

## Installation

### npm

```bash
npm install eventbridge-email-notifier
```

### yarn

```bash
yarn add eventbridge-email-notifier
```

### pnpm

```bash
pnpm add eventbridge-email-notifier
```

## Usage

### Minimal deployable app

```typescript
import { App, Stack, type StackProps } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import { EventBridgeEmailNotifier } from 'eventbridge-email-notifier';

class NotifierStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const topic = new sns.Topic(this, 'AlertTopic');
    const rule = new events.Rule(this, 'PipelineRule', {
      eventPattern: {
        source: ['aws.codepipeline'],
      },
    });

    rule.addTarget(new EventBridgeEmailNotifier(topic, {
      subject: 'Pipeline failed',
    }));
  }
}

const app = new App();

new NotifierStack(app, 'NotifierStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

app.synth();
```

Deploy checklist:

1. Install this package and peers (`aws-cdk-lib`, `constructs`) in your CDK app.
2. After deploy, subscribe the email addresses to the SNS topic. This construct does not create subscriptions.
3. From the CDK app: `npx cdk deploy NotifierStack`

### Subject from the event

```typescript
rule.addTarget(new EventBridgeEmailNotifier(topic, {
  subject: events.EventField.fromPath('$.detail.state'),
  message: events.RuleTargetInput.fromObject({
    pipeline: events.EventField.fromPath('$.detail.pipeline'),
    state: events.EventField.fromPath('$.detail.state'),
  }),
}));
```

`events.RuleTargetInput.fromEventPath('$.detail.state')` sets the same kind of subject. `events.RuleTargetInput.fromText('Pipeline failed')` sets a static subject.

## Options

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `subject` | `string \| events.RuleTargetInput` | _(required)_ | SNS email subject. A string or `RuleTargetInput.fromText` is sanitized at synthesis. `EventField.fromPath` and `RuleTargetInput.fromEventPath` are sanitized when the Lambda runs |
| `message` | `events.RuleTargetInput` | entire EventBridge event | Payload published as the SNS message body |
| `deadLetterQueue` | `sqs.IQueue` | none | EventBridge target DLQ |
| `retryAttempts` | `number` | `185` | EventBridge retry attempts |
| `maxEventAge` | `Duration` | `24 hours` | Maximum event age for retries |

## API

See [API.md](API.md).

## Requirements

- Node.js `>= 20.0.0`
- `aws-cdk-lib` `^2.272.0`
- `constructs` `^10.5.1`

## Notes

- A subject taken from the event is inserted by the EventBridge input transformer. EventBridge does not escape quotes or control characters in that value. If the target input is no longer valid JSON, the Lambda is not invoked and cannot trim the subject.

## Troubleshooting

- If no email arrives, confirm the topic has an email subscription. This library does not add one. Then check the publisher Lambda log group (`/aws/lambda/<function name>`) and, when `deadLetterQueue` is set, that queue.
- An invocation error that says the subject has no non-control character means the event value was empty after sanitization. The invocation fails so a configured dead-letter queue can capture it.

## License

This project is licensed under the (Apache-2.0) License.
