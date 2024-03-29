import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { constructApi, constructEvents, constructS3, getLambdaPath } from './util';

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Constants
    const bucket_name = 'get-image-lambda-bucket';
    const random_image_site_table_name = 'random-image-site';
    const random_image_site_primary_key = 'pk';
    const random_image_site_sort_key = 'sk';
    const web_app_domain = 'jtken.com';
    const image_domain = `images.${web_app_domain}`;

    // Storage resources //

    // S3

    const { 
      bucket,
     } = constructS3(this, {
      bucket_name,
    });

    // Dynamo Tables
    const randomImageSiteTable = new cdk.aws_dynamodb.Table(this, 'RandomImageSiteTable', {
      tableName: random_image_site_table_name,
      partitionKey: { name: random_image_site_primary_key, type: cdk.aws_dynamodb.AttributeType.STRING },
      sortKey: { name: random_image_site_sort_key, type: cdk.aws_dynamodb.AttributeType.STRING },
      billingMode: cdk.aws_dynamodb.BillingMode.PROVISIONED
    });

    randomImageSiteTable.autoScaleReadCapacity({
      minCapacity: 1, 
      maxCapacity: 3,
    });
    randomImageSiteTable.autoScaleWriteCapacity({
      minCapacity: 1,
      maxCapacity: 3
    });

    // Create event driven architecture
    constructEvents(this, {
      bucket_name,
      random_image_site_table_name,
      random_image_site_primary_key,
      random_image_site_sort_key,
    })

    // Create the API
    constructApi(this, {
      bucket_name,
      image_domain,
      random_image_site_table_name,
      random_image_site_primary_key,
      random_image_site_sort_key,
    });


    // Shared between the front-end and the Image CDN

    //Get The Hosted Zone
    const zone = route53.HostedZone.fromLookup(this, 'Zone', {
      domainName: web_app_domain,
    });

    // Image CDN //

    const imageCertificate = new acm.DnsValidatedCertificate(this, 'ImageCertificate', {
      domainName: image_domain,
      hostedZone: zone,
      region: 'us-east-1'
    });

    /** 
     * 
     * WARNING: 
     * Anytime that this is updated need to confirm permissions still exist on the S3 bucket 
     * that allow all CloudFront distributions from this account access. Also need to make sure that OAC is set up for the given bucket 
     * On top of this, the CloudFront distribution itself needs to be edited to use OAC set up for the given bucket. 
     * 
     */
    // TODO: Make the above no longer true and have it update automatically
    const imageDistribution = new cloudfront.CloudFrontWebDistribution(this, 'ImageDistribution', {
      viewerCertificate: cloudfront.ViewerCertificate.fromAcmCertificate(imageCertificate, {
        securityPolicy: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        aliases: [image_domain],
        sslMethod: cloudfront.SSLMethod.SNI
      }),
      originConfigs: [{
        customOriginSource: {
          domainName: bucket.bucketDomainName,
          originProtocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY
        },
        behaviors: [{
          isDefaultBehavior: true
        }]
      }]
    });

    new route53.ARecord(this, 'ImageRecord', {
      recordName: image_domain,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(imageDistribution)),
      zone
    });

    /**
     * The above isn't enough and will lead to access denied errors over and over again. 
     * Since there isn't a way to do the following with CDK right now I just did it manually. 
     * If its possible to do with CDK in the future that is obviously better. 
     * https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html
     */

    // Frontend //

    //Create S3 Bucket for our website
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
        bucketName: web_app_domain,
        websiteIndexDocument: 'index.html',
        publicReadAccess: true,
        removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    //Create Certificate
    const siteCertificate = new acm.DnsValidatedCertificate(this, 'SiteCertificate', {
        domainName: web_app_domain,
        hostedZone: zone,
        region: 'us-east-1'  //standard for acm certs
    });


    //Create CloudFront Distribution
    const siteDistribution = new cloudfront.CloudFrontWebDistribution(this, 'SiteDistribution', {
        viewerCertificate: cloudfront.ViewerCertificate.fromAcmCertificate(siteCertificate, {
            securityPolicy: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
            aliases: [web_app_domain],
            sslMethod: cloudfront.SSLMethod.SNI
        }),
        originConfigs: [{
            customOriginSource: {
                domainName: siteBucket.bucketWebsiteDomainName,
                originProtocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY
            },
            behaviors: [{
                isDefaultBehavior: true
            }]
        }]
    });

    //Create A Record Custom Domain to CloudFront CDN
    new route53.ARecord(this, "SiteRecord", {
      recordName: web_app_domain,
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(siteDistribution)),
      zone
  });

    // Deploy code to s3
    new s3deploy.BucketDeployment(this, 'S3FrontendDeployment', {
      sources: [s3deploy.Source.asset('../frontend/build')],
      destinationBucket: siteBucket,
      distribution: siteDistribution,
      distributionPaths: ["/*"]
    });

  }
}
