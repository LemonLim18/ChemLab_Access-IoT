# This uses the API
from inference_sdk import InferenceHTTPClient

client = InferenceHTTPClient(
    # fyplabwifi
    # api_url="http://192.168.1.116:9001",
    # hotspot
    api_url="http://192.168.43.113:9001",
    api_key="ZPaZtVScXqG1tnWDdOIx"
)

print(client.infer("images/grocery3.jpg", model_id="smart-fridge-co7ul/5"))