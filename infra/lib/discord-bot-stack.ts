import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

/**
 * Stack for setting up infra to run the discord bot. 
 * 
 * Right now whenever this runs (I think) it wipes the EC2 instance. 
 * Since I'm putting the file on the host manually right now that's not ideal. 
 * Could figure out how to automatically deploy the code to the host, but that doesn't seem
 * worth the effort. Would rather run this on Fargate or something anyways
 */
export class DiscordBotStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Constants
    const vpc_name = 'DiscordBotVpc';
    const bucket_name = 'get-image-lambda-bucket';
    const secret_name = 'discord_api_token';

    // Create the secret
    const discordApiTokenSecret = new secretsmanager.Secret(this, 'DiscordBotApiToken', {
        secretName: secret_name,
        description: 'Contains the API token for a Discord Bot. Actual value is manually added'
    });

    // Create the VPC
    const discordBotVpc = new ec2.Vpc(this, 'DiscordBotVpc', {
        vpcName: vpc_name,
        cidr: '10.0.0.0/16',
        gatewayEndpoints: {
            S3: {
                service: ec2.GatewayVpcEndpointAwsService.S3,
            },
            
        },
        subnetConfiguration: [{
            name: `${vpc_name}-PublicSubnets`,
            subnetType: ec2.SubnetType.PUBLIC, 
        }]
    });

    // Add the ec2 instance
    const botInstance = new ec2.Instance(this, 'DiscordBotInstance', {
        vpc: discordBotVpc,
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.NANO),
        machineImage: ec2.MachineImage.latestAmazonLinux({
            generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
            cpuType: ec2.AmazonLinuxCpuType.ARM_64
        }),
        keyName: 'discord-bot-host',
    });

    const botInstanceSg = new ec2.SecurityGroup(this, 'DiscordBotInstanceSecurityGroup', {
        vpc: discordBotVpc,
        allowAllOutbound: true,
        description: 'Discord Bot Security Group'
    });
    
    // TODO: This is way overly permissive, see if its possible to narrow it down
    botInstanceSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'SSH frm anywhere');

    botInstance.addSecurityGroup(botInstanceSg);
    
    // Add the necessary policies
    botInstance.addToRolePolicy(new iam.PolicyStatement({
        actions: ['s3:*'],
        resources: [
            `arn:aws:s3:::${bucket_name}*`, 
            `arn:aws:s3:::${bucket_name}/*`
        ]
    }));

    botInstance.addToRolePolicy(new iam.PolicyStatement({
        actions: [
            'secretsmanager:GetResourcePolicy',
            'secretsmanager:GetSecretValue',
            'secretsmanager:DescribeSecret',
            'secretsmanager:ListSecretVersionIds'
        ],
        resources: [discordApiTokenSecret.secretArn],
    }));
  }
}
