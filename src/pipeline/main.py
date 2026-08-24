def lambda_handler(event, context):
    print("bizcall-pipeline triggered via GitHub Actions deploy test v2")
    return {
        "statusCode": 200,
        "body": "bizcall-pipeline is alive"
    }