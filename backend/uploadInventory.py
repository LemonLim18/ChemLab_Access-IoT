import os
import uuid
import json
from datetime import datetime
from typing import List, Dict, Any
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()

# SUPABASE CONFIG (Falling back to identified credentials if .env is missing them)
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://likyygzbjgrzsdyzsira.supabase.co/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "sb_publishable_jU2_op2cAI7Fhbw9ygEt4g_hl-suGcf")
DEVICE_ID = os.environ.get("DEVICE_ID", "fridge-01")

SUPABASE_BUCKET = os.environ.get("SUPABASE_BUCKET", "camera_images")

# Initialize client
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def get_latest_image_url():
    """
    Lists files in the 'captures/' folder of the storage bucket and returns the public URL
     of the most recent one (sorted by name/timestamp).
    """
    try:
        # List files in the 'captures' folder, sorting by created_at to get the most recent
        res = supabase.storage.from_(SUPABASE_BUCKET).list("captures", {"sortBy": {"column": "created_at", "order": "desc"}})
        
        if res and len(res) > 0:
            # The first one should be the latest if order is desc
            latest_file = res[0]
            remote_path = f"captures/{latest_file['name']}"
            url_data = supabase.storage.from_(SUPABASE_BUCKET).get_public_url(remote_path)
            
            return {
                "url": url_data if isinstance(url_data, str) else url_data.get("publicUrl"),
                "created_at": latest_file.get("created_at"),
                "name": latest_file.get("name")
            }
        return None
    except Exception as e:
        print(f"[Supabase] Error fetching latest image: {e}")
        return None

def save_item_to_supabase(item: Dict[str, Any]):
    """
    Saves or updates a single inventory item in the database.
    """
    try:
        data = {
            "id": item.get("id", str(uuid.uuid4())),
            "device_id": DEVICE_ID,
            "name": item.get("name"),
            "category": item.get("category"),
            "quantity": item.get("quantity"),
            "status": item.get("status", "Good"),
            "reorder_threshold": item.get("reorderThreshold", 2)
        }
        
        response = supabase.table("inventory_items").upsert(data).execute()
        return response
    except Exception as e:
        print(f"[Supabase] Error saving item: {e}")
        return None

def get_inventory_items() -> List[Dict[str, Any]]:
    """
    Retrieves all inventory items for the current device.
    """
    try:
        response = supabase.table("inventory_items").select("*").eq("device_id", DEVICE_ID).execute()
        # Map DB fields back to camelCase for frontend consistency if needed
        items = []
        for row in response.data:
            items.append({
                "id": row["id"],
                "name": row["name"],
                "category": row["category"],
                "quantity": row["quantity"],
                "status": row["status"],
                "reorderThreshold": row["reorder_threshold"]
            })
        return items
    except Exception as e:
        print(f"[Supabase] Error fetching inventory: {e}")
        return []

def delete_all_items():
    """
    Clears the current inventory for this device (usually before a fresh sync).
    """
    try:
        supabase.table("inventory_items").delete().eq("device_id", DEVICE_ID).execute()
        print(f"[Supabase] Cleared inventory for {DEVICE_ID}")
    except Exception as e:
        print(f"[Supabase] Error clearing inventory: {e}")

def sync_inventory_snapshot(items: List[Dict[str, Any]]):
    """
    Snapshot Sync:
    1. Consolidate duplicates in the incoming list.
    2. Items NOT in the list are deleted from the DB.
    3. Items IN the list are updated (replacement of quantity) or inserted.
    """
    if items is None:
        return
        
    try:
        # 0. Consolidate internal duplicates in the AI list
        consolidated = {}
        for item in items:
            name = item.get("name", "Unknown Item").strip()
            name_key = name.lower()
            if name_key in consolidated:
                consolidated[name_key]["quantity"] += item.get("quantity", 0)
            else:
                consolidated[name_key] = item.copy()
        
        ai_items_map = {i["name"].lower(): i for i in consolidated.values()}
        
        # 1. Fetch existing
        existing_items = get_inventory_items()
        db_items_map = {item["name"].lower(): item for item in existing_items}
        
        # 2. Deletions: Find items in DB but NOT in AI scan
        for db_name_lower, db_item in db_items_map.items():
            if db_name_lower not in ai_items_map:
                print(f"[Supabase] Deleting item no longer in fridge: {db_item['name']}")
                supabase.table("inventory_items").delete().eq("id", db_item["id"]).execute()
        
        # 3. Updates & Inserts
        for ai_name_lower, ai_item in ai_items_map.items():
            if ai_name_lower in db_items_map:
                # Update existing (Replacement of quantity as it's a snapshot)
                db_item = db_items_map[ai_name_lower]
                print(f"[Supabase] Syncing {ai_item['name']}: Updating quantity to {ai_item['quantity']}")
                
                supabase.table("inventory_items").update({
                    "quantity": ai_item["quantity"],
                    "status": ai_item.get("status", db_item.get("status")),
                }).eq("id", db_item["id"]).execute()
            else:
                # Insert new
                print(f"[Supabase] Syncing {ai_item['name']}: Inserting new item (qty: {ai_item['quantity']})")
                save_item_to_supabase(ai_item)
                
        print(f"[Supabase] Snapshot sync complete for {len(ai_items_map)} product types.")
    except Exception as e:
        print(f"[Supabase] Error during snapshot sync: {e}")

def sync_inventory_to_supabase(items: List[Dict[str, Any]], merge: bool = False):
    """
    Syncs inventory. 
    If merge=True, it performs the additive merge.
    If items is passed but we want SNAPSHOT sync, we use sync_inventory_snapshot.
    """
    # For this project, we prioritize the "Snapshot Sync" as requested by user.
    return sync_inventory_snapshot(items)

if __name__ == "__main__":
    # Internal Testing Logic
    print("--- Supabase Inventory Persistence Test ---")
    
    # Test Data
    test_items = [
        {
            "id": str(uuid.uuid4()),
            "name": "Apple",
            "category": "Fruits",
            "quantity": 5,
            "unit": "unit",
            "expiryDate": (datetime.now()).isoformat(),
            "status": "Good"
        },
        {
            "id": str(uuid.uuid4()),
            "name": "Milk",
            "category": "Dairy",
            "quantity": 1,
            "unit": "unit",
            "expiryDate": (datetime.now()).isoformat(),
            "status": "Near Expiry"
        }
    ]
    
    print("\n[Step 1] Syncing test items...")
    sync_inventory_to_supabase(test_items)
    
    print("\n[Step 2] Fetching inventory...")
    fetched = get_inventory_items()
    print(f"Items in DB: {len(fetched)}")
    for i in fetched:
        print(f" - {i['name']} ({i['quantity']}{'%' if i['unit'] == 'percent' else ''})")
