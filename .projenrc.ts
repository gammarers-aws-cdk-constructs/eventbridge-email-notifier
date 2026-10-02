import { ProjenCdkConstructLibrary } from '@gammarers/projen-projects';
const project = new ProjenCdkConstructLibrary({
  cdkVersion: '2.272.0',
  name: 'sns-email-notifier',
  repositoryUrl: 'https://github.com/gammarers-aws-cdk-constructs/sns-email-notifier.git',
  devDeps: [
    '@gammarers/projen-projects@^0.5.0',
  ],
});
project.synth();