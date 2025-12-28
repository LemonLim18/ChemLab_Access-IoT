
import os
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://likyygzbjgrzsdyzsira.supabase.co/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "sb_publishable_jU2_op2cAI7Fhbw9ygEt4g_hl-suGcf")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

test_recipe = {
    "device_id": "test-script",
    "name": "Backend Test Recipe",
    "description": "Checking if this uploads",
    "image_url": "https://example.com/image.jpg",
    "cook_time": "10 mins",
    "difficulty": "Easy",
    "full_ingredients": ["test item 1"],
    "instructions": ["Step 1: Test"]
}

print(f"Attempting to insert into 'saved_recipes' at {SUPABASE_URL}...")
try:
    response = supabase.table("saved_recipes").insert(test_recipe).execute()
    print("SUCCESS!")
    print(response.data)
except Exception as e:
    print("\nFAILED!")
    print(f"Error Type: {type(e).__name__}")
    print(f"Error Message: {str(e)}")
