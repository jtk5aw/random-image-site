#!/bin/bash

# Script to copy files from a source S3 bucket to a target S3 bucket
# Usage: ./copy-to-upload-bucket.sh <source-bucket> <target-bucket> [group] [userid] [provider]

set -e

# Check if both source and target buckets are provided
if [ $# -lt 2 ]; then
    echo "Usage: $0 <source-bucket> <target-bucket> [group] [userid] [provider]"
    echo "Example: $0 my-source-bucket my-target-bucket default user123 apple"
    exit 1
fi

SOURCE_BUCKET="$1"
TARGET_BUCKET="$2"
GROUP="${3:-default}"
USERID="${4:-system}"
PROVIDER="${5:-apple}"
UPLOAD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")

echo "Copying files from $SOURCE_BUCKET to $TARGET_BUCKET"
echo "Metadata: group=$GROUP, userid=$USERID, provider=$PROVIDER, uploadtime=$UPLOAD_TIME"
echo ""

# List objects in source bucket with group prefix
echo "Listing objects in source bucket with prefix '$GROUP'..."
aws s3api list-objects-v2 --bucket "$SOURCE_BUCKET" --prefix "$GROUP" --query 'Contents[].Key' --output text | tr '\t' '\n' | while read -r key; do
    if [ -n "$key" ]; then
        # Generate a new UUID for the target filename
        new_key=$(uuidgen | tr '[:upper:]' '[:lower:]')
        
        echo "Copying $key -> $new_key"

        
        # Get original object metadata and content-type
        original_metadata=$(aws s3api head-object --bucket "$SOURCE_BUCKET" --key "$key" --query 'Metadata' --output json)
        content_type=$(aws s3api head-object --bucket "$SOURCE_BUCKET" --key "$key" --query 'ContentType' --output text)
        
        # Copy object with metadata and preserve content-type
        aws s3api copy-object \
            --copy-source "$SOURCE_BUCKET/$key" \
            --bucket "$TARGET_BUCKET" \
            --key "$new_key" \
            --metadata "userid=$USERID,group=$GROUP,provider=$PROVIDER,uploadtime=$UPLOAD_TIME" \
            --content-type "$content_type" \
            --metadata-directive REPLACE
            
        echo "✓ Copied $key to $new_key"
    fi
done

echo ""
echo "Copy operation completed!"
echo "Files copied to bucket: $TARGET_BUCKET"
