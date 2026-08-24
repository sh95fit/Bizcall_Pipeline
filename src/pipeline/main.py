def lambda_handler(event, context):
    print("bizcall-pipeline triggered via GitHub Actions deploy test")
    return {
        "statusCode": 200,
        "body": "bizcall-pipeline is alive"
    }