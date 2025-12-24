# This uses the API

from inference_sdk import InferenceHTTPClient

CLIENT = InferenceHTTPClient(
    api_url="https://serverless.roboflow.com",
    api_key="ZPaZtVScXqG1tnWDdOIx"
)

result = CLIENT.infer("milk.jpg", model_id="fridgedetection/3")

print(result)