import google.generativeai as genai
import os
import json
import base64
from typing import List, Dict, Any
from dotenv import load_dotenv
from item_dictionary import EN_MS_MAP

# Load environment variables
load_dotenv()

# Configure the Gemini API
API_KEY = os.environ.get("GEMINI_API_KEY")
if not API_KEY:
    # Try VITE_API_KEY as fallback if it was set before
    API_KEY = os.environ.get("VITE_API_KEY")

if API_KEY:
    genai.configure(api_key=API_KEY)
else:
    print("Warning: GEMINI_API_KEY not found in environment variables.")

def safe_json_parse(text: str) -> Any:
    """
    Strips markdown code blocks and attempts to parse JSON.
    """
    try:
        # Strip code blocks like ```json ... ``` or just ``` ... ```
        clean_text = text.strip()
        if clean_text.startswith("```"):
            # Find the first newline after the triple backticks
            first_newline = clean_text.find("\n")
            if first_newline != -1:
                clean_text = clean_text[first_newline:].strip()
            # Strip trailing backticks
            if clean_text.endswith("```"):
                clean_text = clean_text[:-3].strip()
        
        return json.loads(clean_text)
    except Exception as e:
        print(f"JSON Parse Error: {e}")
        print(f"Raw text that failed: {text}")
        return None

def generate_recipes(items: List[Dict[str, Any]], user_prompt: str = "", strict_mode: bool = False) -> List[Dict[str, Any]]:
    item_names = ", ".join([i.get("name", "") for i in items])
    
    strict_instruction = ""
    if strict_mode:
        strict_instruction = "STRICT RULE: Focus 100% on the available items. Do NOT suggest recipes that require missing ingredients. Use only what is in the fridge."
    else:
        strict_instruction = "FLEXIBLE RULE: Prioritize available items, but you can suggest adding 1-2 minor ingredients if it makes the dish significantly better."

    prompt = f"""
        Inventory: {item_names}.
        User Request: {user_prompt or 'Suggest anything good.'}
        Role: You are a professional chef. Suggest 3 creative recipes.
        {strict_instruction}
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
    
    result = safe_json_parse(response.text)
    return result if result is not None else []

def get_recipe_details(recipe_name: str, items: List[Dict[str, Any]]) -> Dict[str, Any]:
    item_names = ", ".join([i.get("name", "") for i in items])
    prompt = f"""
        Provide a detailed cookbook entry for the recipe: "{recipe_name}".
        Context: I have {item_names} in my fridge.
        Provide a full list of ingredients (quantities included) and clear, numbered, step-by-step instructions.
        Format: Return as JSON object with: fullIngredients (list of strings), instructions (list of strings).
    """
    
    model = genai.GenerativeModel('gemini-2.5-flash')
    response = model.generate_content(
        prompt,
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
        )
    )
    
    result = safe_json_parse(response.text)
    return result if result is not None else {"fullIngredients": [], "instructions": []}

def analyze_snapshot(image_base64: str) -> Dict[str, Any]:
    # Analyze this image and provide a detailed list of item categories and their counts.
    allowed_items = ", ".join(EN_MS_MAP.keys())
    prompt = f"""
        Analyze this fridge snapshot. Identify all identified food items.
        
        CRITICAL: Use "Natural Human Naming". This means:
        - Use generic but descriptive terms that a normal human would use (e.g., "Orange Juice", "Milk", "Yogurt", "Cheese", "Soda", "Apple", "Alcohol").
        - Avoid over-generalizing: Do NOT map "Orange Juice" to just "Orange". If it's a distinct product, use the common name for it.
        - Avoid over-specifying: Do NOT include brand names or packaging details (e.g., use "Yogurt", not "Yogurt with red cap").
        
        CRITICAL RULES:
        1. DO NOT mention any color of the items (e.g., no "Red Apple", no "Green Grapes", no "White Milk"). Use ONLY the common name.
        2. DO NOT use "percent" or "count" for the unit field. You MUST use "unit" for ALL items (e.g., 1 unit, 2 unit).
        
        The goal is for someone who hasn't seen the fridge to be able to clearly imagine the items in their mind.
        
        For each item, provide:
        - name: The natural, generic human name (MUST NOT contain color).
        - category: Exactly one of: 'Fruits', 'Vegetables', 'Dairy', 'Meat', 'Beverages', 'Sauces', 'Leftovers', 'Other'
        - quantity: A number representing the count/amount (e.g. 1, 2, 0.5)
        - status: Exactly one of: 'Good', 'Near Expiry', 'Expired', 'Spoiled'
        
        Format: Return as a JSON object with a single key "items" containing an array of these objects.
    """
    
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
    
    result = safe_json_parse(response.text)
    if result:
        print(f"[AI] Successfully parsed inventory: {json.dumps(result, indent=2)}")
    return result if result is not None else {"items": []}

if __name__ == "__main__":
    # Internal Testing Logic
    print("--- Gemini Recipe AI Standalone Test ---")
    
    # # Test 1: Recipe Generation
    # test_items = [{"name": "Chicken"}, {"name": "Onion"}, {"name": "Garlic"}]
    # print(f"\n[Test 1] Generating recipes for: {test_items}")
    # recipes = generate_recipes(test_items, "Something spicy")
    # print(json.dumps(recipes, indent=2))
    
    # Test 2: Image Analysis
    # To test this, make sure you have an image file at backend/test_fridge.jpg
    test_img = "images/fridge.png"
    if os.path.exists(test_img):
        print(f"\n[Test 2] Analyzing local image: {test_img}")
        with open(test_img, "rb") as image_file:
            encoded_string = base64.b64encode(image_file.read()).decode('utf-8')
            analysis = analyze_snapshot(encoded_string)
            print(json.dumps(analysis, indent=2))
    else:
        print(f"\n[Test 2] Skip: No test image found at '{test_img}'")
