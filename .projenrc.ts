import { ProjenCdkConstructLibrary } from '@gammarers/projen-projects';
const project = new ProjenCdkConstructLibrary({
  releaseToNpm: true,
  npmTrustedPublishing: true,
  cdkVersion: '2.272.0',
  name: 'eventbridge-email-notifier',
  repositoryUrl: 'https://github.com/gammarers-aws-cdk-constructs/eventbridge-email-notifier.git',
  description: 'EventBridge rule target that sends email through Amazon SNS with a static or event-derived subject.',
  keywords: ['aws', 'cdk', 'construct', 'eventbridge', 'email', 'notifier'],
  devDeps: [
    '@gammarers/projen-projects@^0.5.10',
    '@aws-sdk/client-sns@^3.1146.0',
    '@smithy/node-http-handler@^4.14.2',
    'aws-sdk-client-mock@^4.1.0',
    'aws-sdk-client-mock-jest@^4.1.0',
    'quiet-json-parser@^0.4.3',
  ],
});
project.synth();