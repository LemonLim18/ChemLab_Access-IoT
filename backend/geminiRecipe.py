import google.generativeai as genai
import os
import json
import base64
from typing import List, Dict, Any

# Configure the Gemini API
API_KEY = os.environ.get("GEMINI_API_KEY")
if not API_KEY:
    # Try VITE_API_KEY as fallback if it was set before
    API_KEY = os.environ.get("VITE_API_KEY")

if API_KEY:
    genai.configure(api_key=API_KEY)
else:
    print("Warning: GEMINI_API_KEY not found in environment variables.")

def generate_recipes(items: List[Dict[str, Any]], user_prompt: str = "") -> List[Dict[str, Any]]:
    item_names = ", ".join([i.get("name", "") for i in items])
    prompt = f"""
        Inventory: {item_names}.
        User Request: {user_prompt or 'Suggest anything good.'}
        Role: You are a professional chef. Suggest 3 creative recipes using mostly the available inventory. 
        Format: Return as JSON array of recipe objects.
        Each object must have: name, description, missingIngredients (list), cookTime, difficulty.
    """
    
    model = genai.GenerativeModel('gemini-2.5-flash')
    response = model.generate_content(
        prompt,
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
        )
    )
    
    try:
        return json.loads(response.text)
    except Exception as e:
        print(f"Error parsing Gemini response: {e}")
        return []

def get_recipe_details(recipe_name: str, items: List[Dict[str, Any]]) -> Dict[str, Any]:
    item_names = ", ".join([i.get("name", "") for i in items])
    prompt = f"""
        Provide a detailed cookbook entry for the recipe: "{recipe_name}".
        Context: I have {item_names} in my fridge.
        Provide a full list of ingredients (quantities included) and clear, numbered, step-by-step instructions.
        Format: Return as JSON object with: fullIngredients (list of strings), instructions (list of strings).
    """
    
    model = genai.GenerativeModel('gemini-2.5-flash')
    asphalt_recipes = [] # placeholder if needed, though not in original logic
    response = model.generate_content(
        prompt,
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
        )
    )
    
    try:
        return json.loads(response.text)
    except Exception as e:
        print(f"Error parsing Gemini response: {e}")
        return {"fullIngredients": [], "instructions": []}

def analyze_snapshot(image_base64: str) -> Dict[str, Any]:
    prompt = "Analyze this fridge snapshot. Identify any new food items, estimate their quantity, and suggest their category and typical expiry duration from today."
    
    # Extract mime type and data if it's a data URL
    if ";" in image_base64 and "," in image_base64:
        header, image_data = image_base64.split(",", 1)
        mime_type = header.split(";")[0].split(":")[1]
    else:
        image_data = image_base64
        mime_type = "image/jpeg"
        
    image_bytes = base64.b64decode(image_data)
    
    model = genai.GenerativeModel('gemini-2.5-flash')
    response = model.generate_content(
        [
            prompt,
            {"mime_type": mime_type, "data": image_bytes}
        ],
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
        )
    )
    
    try:
        return json.loads(response.text)
    except Exception as e:
        print(f"Error parsing Gemini response: {e}")
        return {"items": []}
