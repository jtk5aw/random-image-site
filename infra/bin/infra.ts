#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { InfraStack } from '../lib/infra-stack';
import { DiscordBotStack } from '../lib/discord-bot-stack';

const app = new cdk.App();
const env = {
  env: { account: '961305444646', region: 'us-west-1' },
};
new InfraStack(app, 'InfraStack', env);
new DiscordBotStack(app, 'DiscordBotStack', env);