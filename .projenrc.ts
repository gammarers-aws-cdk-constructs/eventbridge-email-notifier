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
    'quiet-json-parser@^0.3.2',
  ],
});
project.synth();