#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { InfraStack } from '../lib/infra-stack';

const app = new cdk.App();

// The default account should be 961305444646. have to do this so SSO can be used
const env = {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-west-1' },
};
new InfraStack(app, 'InfraStack', env);
