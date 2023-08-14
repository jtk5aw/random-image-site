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
user_reaction_table = glueContext.create_dynamic_frame.from_catalog(database="random-image-site", table_name="user_reaction_table", transformation_ctx="AmazonDynamoDB_node1691987581965")

print("Schema for the user_reaction_table DynamicFrame:")
user_reaction_table.printSchema()

# Use map to apply MergeAddress to every record
def convert(rec):
    rec["pk"] = "discord_" + rec["date"]
    if rec["user"] != "ReactionCounts": 
        rec["sk"] = "user#" + rec["user"]
    else: 
        rec["sk"] = rec["user"]
    return rec

user_reaction_table_mapped = user_reaction_table.map(f = convert)
print("Schema for user_reaction_table_mapped DynamicFrame:")
user_reaction_table_mapped.printSchema()

user_reaction_table_dropped = user_reaction_table_mapped.drop_fields(paths=["date", "user"])
print("Schema for user_reaction_table_dropped DynamicFrame:")
user_reaction_table_dropped.printSchema()


Datasink1 = glueContext.write_dynamic_frame.from_options(
    frame=user_reaction_table_dropped,
    connection_type="dynamodb",
    connection_options={
        "dynamodb.output.tableName": "random-image-site",
        "dynamodb.throughput.write.percent": "0.5"
    }
)

job.commit()
