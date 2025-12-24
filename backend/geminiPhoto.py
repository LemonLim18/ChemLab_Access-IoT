import PIL.Image
from google import genai

# ----------------- CONFIG -----------------
image = PIL.Image.open('images/grocery2.png')


client = genai.Client(api_key="AIzaSyAmuoHZqHBIGaSKwSnPIKHjYKP5keKx1Ko")
response = client.models.generate_content(
    model="gemini-2.5-flash", # Use the latest validated model version
    contents=["Analyze this image and provide a detailed list of item categories and their counts.", image]
)

print(response.text)