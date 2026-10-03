import { ProjenCdkConstructLibrary } from '@gammarers/projen-projects';
import { awscdk } from 'projen';

const project = new ProjenCdkConstructLibrary({
  cdkVersion: '2.272.0',
  name: 'eventbridge-email-notifier',
  repositoryUrl: 'https://github.com/gammarers-aws-cdk-constructs/eventbridge-email-notifier.git',
  // *.lambda.ts handlers are bundled at build time so each channel can grow on its own.
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

// npm test does not run pre-compile; bundle assets before Jest synthesizes them.
const bundleTask = project.tasks.tryFind('bundle');
if (bundleTask !== undefined) {
  project.testTask.prependSpawn(bundleTask);
}

project.synth();