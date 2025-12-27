import os
import json
from dotenv import load_dotenv
import requests

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://likyygzbjgrzsdyzsira.supabase.co/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "sb_publishable_jU2_op2cAI7Fhbw9ygEt4g_hl-suGcf")

def debug_shopping_list():
    url = f"{SUPABASE_URL}/rest/v1/shopping_list?select=id,name,device_id,completed&order=name.asc"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}"
    }
    
    try:
        response = requests.get(url, headers=headers)
        if response.status_code == 200:
            data = response.json()
            print(f"TOTAL_ITEMS: {len(data)}")
            for item in data:
                print(f"ITEM: {json.dumps(item)}")
        else:
            print(f"Error: {response.status_code}")
    except Exception as e:
        print(f"Request failed: {e}")

if __name__ == "__main__":
    debug_shopping_list()
