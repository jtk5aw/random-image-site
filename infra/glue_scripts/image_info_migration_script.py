import sys
from awsglue.transforms import *
from awsglue.utils import getResolvedOptions
from pyspark.context import SparkContext
from awsglue.context import GlueContext
from awsglue.job import Job

args = getResolvedOptions(sys.argv, ['JOB_NAME'])
sc = SparkContext()
glueContext = GlueContext(sc)
spark = glueContext.spark_session
job = Job(glueContext)
job.init(args['JOB_NAME'], args)

# Script generated for node Amazon DynamoDB
random_image_site = glueContext.create_dynamic_frame.from_catalog(database="random-image-site", table_name="image_info_table", transformation_ctx="AmazonDynamoDB_node1691987581965")

print("Schema for the random_image_site DynamicFrame:")
random_image_site.printSchema()

# Use map to apply MergeAddress to every record
def convert(rec):
    rec["pk"] = "discord_" + rec["id"]
    rec["sk"] = "Image"
    return rec

random_image_site_mapped = random_image_site.map(f = convert)
print("Schema for random_image_site_mapped DynamicFrame:")
random_image_site_mapped.printSchema()

random_image_site_dropped = random_image_site_mapped.drop_fields(paths=["id"])
print("Schema for random_image_site_dropped DynamicFrame:")
random_image_site_dropped.printSchema()


Datasink1 = glueContext.write_dynamic_frame.from_options(
    frame=random_image_site_dropped,
    connection_type="dynamodb",
    connection_options={
        "dynamodb.output.tableName": "random-image-site",
        "dynamodb.throughput.write.percent": "0.5"
    }
)

job.commit()
