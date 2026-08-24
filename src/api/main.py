def lambda_handler(event, context):
    print("bizcall-api triggered via GitHub Actions deploy test v2")
    return {
        "statusCode": 200,
        "body": "bizcall-api is alive"
    }