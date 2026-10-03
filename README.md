# EventBridge Email Notifier (CDK v2)

[![npm version](https://img.shields.io/npm/v/eventbridge-email-notifier?style=flat-square)](https://www.npmjs.com/package/eventbridge-email-notifier)
[![license](https://img.shields.io/npm/l/eventbridge-email-notifier?style=flat-square)](https://www.npmjs.com/package/eventbridge-email-notifier)
[![Node.js](https://img.shields.io/node/v/eventbridge-email-notifier?style=flat-square)](https://www.npmjs.com/package/eventbridge-email-notifier)
[![build](https://img.shields.io/github/actions/workflow/status/gammarers-aws-cdk-constructs/eventbridge-email-notifier/build.yml?label=build&style=flat-square)](https://github.com/gammarers-aws-cdk-constructs/eventbridge-email-notifier/actions/workflows/build.yml)

[![View on Construct Hub](https://constructs.dev/badge?package=eventbridge-email-notifier)](https://constructs.dev/packages/eventbridge-email-notifier)

EventBridge rule target that sends email through Amazon SNS with a custom subject.

## Features

- Plug into an existing EventBridge rule via `rule.addTarget(...)`
- Custom SNS email subject (EventBridge cannot set subject when SNS is a direct target)
- Subject sanitization for SNS Publish limits (control characters removed, max 99 chars)
- EventBridge target dead-letter queue and retry settings
- Topic policy that allows only `email` / `email-json` Subscribe protocols

## How it works

EventBridge invokes a small Lambda publisher. The Lambda calls SNS `Publish` with your subject and message. Email subscriptions are not created by this library; add them in the console or API when addresses change.

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

```ts
import { Duration } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { EventBridgeEmailNotifier } from 'eventbridge-email-notifier';

const topic = new sns.Topic(this, 'AlertTopic');
const rule = new events.Rule(this, 'PipelineRule', {
  eventPattern: {
    source: ['aws.codepipeline'],
  },
});

rule.addTarget(new EventBridgeEmailNotifier(topic, {
  subject: 'Pipeline failed',
  message: events.RuleTargetInput.fromText('Check CodePipeline'),
  deadLetterQueue: new sqs.Queue(this, 'NotifierDlq'),
  retryAttempts: 2,
  maxEventAge: Duration.hours(2),
}));
```

## Options

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `subject` | `string` | _(required)_ | SNS email subject (sanitized to SNS limits) |
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

## License

This project is licensed under the (Apache-2.0) License.
