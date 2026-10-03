import { ProjenCdkConstructLibrary } from '@gammarers/projen-projects';
import { awscdk } from 'projen';

const project = new ProjenCdkConstructLibrary({
  cdkVersion: '2.272.0',
  name: 'eventbridge-email-notifier',
  repositoryUrl: 'https://github.com/gammarers-aws-cdk-constructs/eventbridge-email-notifier.git',
  description: 'EventBridge rule target that sends email through Amazon SNS with a custom subject.',
  keywords: ['aws', 'cdk', 'construct', 'eventbridge', 'email', 'notifier'],
  lambdaOptions: {
    runtime: awscdk.LambdaRuntime.NODEJS_22_X,
  },
  devDeps: [
    '@gammarers/projen-projects@^0.5.0',
    '@aws-sdk/client-sns@^3.1146.0',
    'strict-env-resolver@^0.7.2',
    'quiet-json-parser@^0.3.2',
  ],
});
project.synth();