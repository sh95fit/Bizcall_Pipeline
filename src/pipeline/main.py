import json

def lambda_handler(event, context):
    print("bizcall-pipeline received event:", json.dumps(event))
    for record in event.get("Records", []):
        body = json.loads(record["body"])
        for s3_record in body.get("Records", []):
            bucket = s3_record["s3"]["bucket"]["name"]
            key = s3_record["s3"]["object"]["key"]
            print(f"Detected S3 object -> bucket: {bucket}, key: {key}")
    return {"statusCode": 200, "body": "bizcall-pipeline is alive"}