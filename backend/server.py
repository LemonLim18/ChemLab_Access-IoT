# TO START THE SERVER: 
# uvicorn server:app --host 0.0.0.0 --port 8000 --reload
# backend_app.py
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from dotenv import load_dotenv
import os
import json
import asyncio
import paho.mqtt.client as mqtt

# Load environment variables from .env file
load_dotenv()
from pydantic import BaseModel
from typing import Optional, List, Any, Dict
import requests
import base64
import recommender  # your original file; we do not modify it
import geminiRecipe
import uploadInventory
import pandas as pd
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
import time
from datetime import datetime, timedelta
import uuid
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Price Recommender API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Broaden for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- MQTT & WebSocket Integration ---

# Intelligent Thresholds based on Category
CATEGORY_THRESHOLDS = {
    "Fruits": 3,
    "Vegetables": 2,
    "Dairy": 2,
    "Meat": 1,
    "Beverages": 2,
    "Sauces": 0.5,
    "Leftovers": 1,
    "Other": 1
}

# Shared state for real-time sensor data
latest_sensor_data = {
    "temperature": 0.0,
    "humidity": 0,
    "voc": 0,
    "doorOpen": False,
    "moistureAlert": False,
    "latest_image_url": None,
    "lastCaptureTime": None,
    "inventory": [],
    "lastUpdated": datetime.now().isoformat()
}

def init_state_from_supabase():
    """
    Hydrates the backend state from Supabase on startup.
    """
    global latest_sensor_data
    print("[Startup] Initializing state from Supabase...")
    try:
        # 1. Fetch Latest Inventory
        db_items = uploadInventory.get_inventory_items()
        if db_items:
            latest_sensor_data["inventory"] = db_items
            print(f"[Startup] Loaded {len(db_items)} items from DB.")
        
        # 2. Fetch Latest Image
        image_info = uploadInventory.get_latest_image_url()
        if image_info:
            latest_sensor_data["latest_image_url"] = image_info["url"]
            latest_sensor_data["lastCaptureTime"] = image_info["created_at"] or image_info["name"]
            print(f"[Startup] Loaded latest image: {image_info['url']}")
        else:
            print("[Startup] No previous images found in Supabase.")
    except Exception as e:
        print(f"[Startup] Error during initialization: {e}")

# Initialize state immediately
init_state_from_supabase()

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        # Send latest data immediately upon connection
        await websocket.send_json({"type": "sensor_update", "data": latest_sensor_data})
        if latest_sensor_data["latest_image_url"]:
            await websocket.send_json({
                "type": "capture_update", 
                "data": {"image_url": latest_sensor_data["latest_image_url"]}
            })

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass

manager = ConnectionManager()

# MQTT Config
MQTT_BROKER = "35.194.40.109"
MQTT_PORT = 1883
MQTT_USER = "smartfridge"
MQTT_PASS = "password"

def on_connect(client, userdata, flags, rc):
    print(f"Connected to MQTT Broker with result code {rc}")
    client.subscribe("fridge/#")

main_loop = None

def on_message(client, userdata, msg):
    global latest_sensor_data, main_loop
    try:
        payload = json.loads(msg.payload.decode())
        topic = msg.topic
        
        update_broadcast = False
        message_to_send = None

        if topic == "fridge/telemetry":
            latest_sensor_data["temperature"] = payload.get("temperature_celsius", latest_sensor_data["temperature"])
            latest_sensor_data["humidity"] = payload.get("humidity_percent", latest_sensor_data["humidity"])
            latest_sensor_data["voc"] = payload.get("voc_ppm", latest_sensor_data["voc"])
            latest_sensor_data["lastUpdated"] = datetime.now().isoformat()
            message_to_send = {"type": "sensor_update", "data": latest_sensor_data}
            update_broadcast = True
        
        elif topic == "fridge/door":
            state = payload.get("state", "closed")
            latest_sensor_data["doorOpen"] = (state.lower() == "open")
            latest_sensor_data["lastUpdated"] = datetime.now().isoformat()
            message_to_send = {"type": "sensor_update", "data": latest_sensor_data}
            update_broadcast = True
            
        elif topic == "fridge/capture":
            # If the mqtt sends the capture signal, then it wil be captured by the backend
            img_url = payload.get("image_url")
            print(f"[MQTT] Received new fridge snapshot: {img_url}")
            latest_sensor_data["latest_image_url"] = img_url
            latest_sensor_data["lastCaptureTime"] = datetime.now().isoformat()
            message_to_send = {
                "type": "capture_update",
                "data": {
                    "image_url": img_url,
                    "timestamp": datetime.now().isoformat()
                }
            }
            update_broadcast = True
            
            # Trigger background AI analysis
            if main_loop:
                asyncio.run_coroutine_threadsafe(analyze_image_task(img_url), main_loop)

        if update_broadcast and message_to_send and main_loop:
            asyncio.run_coroutine_threadsafe(manager.broadcast(message_to_send), main_loop)

    except Exception as e:
        print(f"Error processing MQTT message: {e}")

async def analyze_image_task(img_url: str):
    """
    Background task to fetch image, analyze via Gemini, and broadcast update.
    """
    global latest_sensor_data, main_loop
    try:
        print(f"[AI] Starting image analysis for: {img_url}")
        
        # 1. Fetch image content
        response = requests.get(img_url, timeout=10)
        if response.status_code != 200:
            print(f"[AI] Error: Failed to fetch image (Status {response.status_code})")
            return

        # 2. Convert to Base64
        image_base64 = base64.b64encode(response.content).decode('utf-8')
        
        # 3. Analyze via Gemini (using executor to keep loop free)
        loop = asyncio.get_running_loop()
        analysis_result = await loop.run_in_executor(None, geminiRecipe.analyze_snapshot, image_base64)
        
        # 4. Update state and broadcast
        raw_items = analysis_result.get("items", [])
        enriched_items = []
        now = datetime.now()
        
        for item in raw_items:
            cat = item.get("category", "Other")
            threshold = CATEGORY_THRESHOLDS.get(cat, CATEGORY_THRESHOLDS["Other"])
            
            enriched_item = {
                "id": str(uuid.uuid4()),
                "name": item.get("name", "Unknown Item"),
                "category": cat,
                "quantity": item.get("quantity", 1),
                "status": item.get("status", "Good"),
                "reorderThreshold": threshold
            }
            enriched_items.append(enriched_item)

        # 5. Persistent Sync (Merge mode)
        uploadInventory.sync_inventory_to_supabase(enriched_items, merge=True)

        # 6. Refresh local state from DB to get the FULL merged list
        full_inventory = uploadInventory.get_inventory_items()
        latest_sensor_data["inventory"] = full_inventory
        
        print(f"[AI] Analysis complete. Merged DB now has {len(full_inventory)} items.")
        
        if main_loop:
            update_msg = {
                "type": "inventory_update",
                "data": {
                    "items": full_inventory,
                    "timestamp": now.isoformat()
                }
            }
            asyncio.run_coroutine_threadsafe(manager.broadcast(update_msg), main_loop)

    except Exception as e:
        print(f"[AI] Error during analysis: {e}")

mqtt_client = mqtt.Client()
mqtt_client.username_pw_set(MQTT_USER, MQTT_PASS)
mqtt_client.on_connect = on_connect
mqtt_client.on_message = on_message

@app.on_event("startup")
async def startup_event():
    global main_loop
    main_loop = asyncio.get_running_loop()
    mqtt_client.connect_async(MQTT_BROKER, MQTT_PORT, 60)
    mqtt_client.loop_start()

@app.on_event("shutdown")
async def shutdown_event():
    mqtt_client.loop_stop()
    mqtt_client.disconnect()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# Class is something similar to the interface in TypeScript
class RecommendRequest(BaseModel):
    product: str
    user_lat: Optional[float] = None
    user_lon: Optional[float] = None
    max_results: Optional[int] = 20
    # optional area override (if you want to force a state/district filter)
    state_hint: Optional[str] = None
    district_hint: Optional[str] = None

class RecommendRow(BaseModel):
    premise: Optional[str]
    min_price: Optional[float]
    distance_km: Optional[float]
    lat: Optional[float]
    lon: Optional[float]
    geocode_source: Optional[str]
    address: Optional[str]
    state: Optional[str]
    district: Optional[str]
    last_date: Optional[Any]

class RecipeRequest(BaseModel):
    items: List[Dict[str, Any]]
    user_prompt: Optional[str] = ""

class RecipeDetailsRequest(BaseModel):
    recipe_name: str
    items: List[Dict[str, Any]]

class SnapshotRequest(BaseModel):
    image_base64: str

@app.post("/recommend", response_model=List[RecommendRow])
def recommend(req: RecommendRequest):
    """
    Returns top places selling `product` near user's location (or globally if location not available).
    This reuses the logic in recommender.py (download_and_aggregate, geocoders, cache).
    """
    # 1) Load price data using your original function (no changes to recommender.py)
    try:
        df = recommender.download_and_aggregate()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load price data: {e}")

    expected_cols = {
        "date","premise_code","item_code","price","premise",
        "address","premise_type","state","district","item",
        "unit","item_group","item_category"
    }
    missing = expected_cols - set(df.columns)
    if missing:
        # not fatal; warn via HTTP 400? we just continue but include in detail
        # keep behaviour similar to original script (it printed a warning)
        pass

    # 2) Use client-provided location
    user_lat = req.user_lat
    user_lon = req.user_lon
    
    # 3) Initialize addr_info for localized area filtering
    addr_info = {"pretty": None, "state": None, "district": None}
    
    if user_lat is not None and user_lon is not None:
        try:
            from geopy.geocoders import Nominatim as GeoNominatim
            g = GeoNominatim(user_agent="smartfridge_ai_2025")
            loc_rev = g.reverse((user_lat, user_lon), exactly_one=True, timeout=8)
            if loc_rev:
                raw_addr = loc_rev.raw.get("address", {})
                state = raw_addr.get("state") or raw_addr.get("state_district")
                district = raw_addr.get("county") or raw_addr.get("city_district") or raw_addr.get("suburb")
                pretty = ", ".join([raw_addr.get(k) for k in ("road","suburb","county","state","postcode","country") if raw_addr.get(k)])
                addr_info = {"pretty": pretty, "state": state, "district": district}
        except Exception:
            pass

    # override with hints from request if provided
    if req.state_hint:
        addr_info["state"] = req.state_hint
    if req.district_hint:
        addr_info["district"] = req.district_hint

    # 4) Area filtering
    df_area = df.copy()
    if addr_info and addr_info.get("state"):
        df_area = df_area[df_area["state"].fillna("").str.lower().str.contains(str(addr_info["state"]).lower(), na=False)]
    if not df_area.empty and addr_info and addr_info.get("district"):
        df_d = df_area[df_area["district"].fillna("").str.lower().str.contains(str(addr_info["district"]).lower(), na=False)]
        if not df_d.empty:
            df_area = df_d
    if df_area.empty:
        df_area = df.copy()

    # 5) Product matching (use your original matcher)
    product_q = req.product.strip()
    if not product_q:
        raise HTTPException(status_code=400, detail="Empty product provided")

    if product_q.isdigit():
        df_prod = df_area[df_area["item_code"].astype(str) == product_q]
    else:
        items = df_area["item"].dropna().unique().tolist()
        matched_items = recommender.match_items(product_q, items)
        if not matched_items:
            raise HTTPException(status_code=404, detail="No matching product found")
        best_match = matched_items[0][0]
        df_prod = df_area[df_area["item"].fillna("").str.lower().str.contains(best_match.lower())]

    if df_prod.empty:
        raise HTTPException(status_code=404, detail="No matching product rows found")

    # ensure numeric price (same as original)
    df_prod.loc[:, "price"] = pd.to_numeric(df_prod["price"], errors="coerce")

    grouped = (
        df_prod
        .groupby(["premise_code","premise","address","state","district"], as_index=False)
        .agg(min_price=("price","min"), last_date=("date","max"))
        .dropna(subset=["min_price"])
        .sort_values("min_price")
        .reset_index(drop=True)
    )

    top = grouped.head(max(50, req.max_results)).copy()  # compute more then we will sort by distance and limit later

    # 6) Geocoding with cache + concurrency
    cache = recommender.load_geocache()
    cache_lock = Lock()

    distances = []
    lats = []
    lons = []
    sources = []

    # worker uses the same geocoding strategy as the original recommender.main
    def geocode_worker(args):
        idx, raw_addr, district, state = args
        key_preview = (raw_addr or "")[:80].replace("\n", " ")
        lat_p = lon_p = None
        src = None

        key = raw_addr.strip() if raw_addr and isinstance(raw_addr, str) else ""

        # check cache under lock
        if key:
            with cache_lock:
                entry = cache.get(key) if key in cache else None
            if entry is not None:
                if entry:
                    lat_p, lon_p = entry.get("lat"), entry.get("lon")
                    src = entry.get("source", "cache")
                else:
                    lat_p = lon_p = None
                    src = None
                d = recommender.haversine_km(user_lat, user_lon, lat_p, lon_p) if (user_lat is not None and lat_p is not None and lon_p is not None) else None
                return idx, d, lat_p, lon_p, src

        # not in cache or no key
        if not raw_addr or not isinstance(raw_addr, str) or not raw_addr.strip():
            lat_p, lon_p = recommender.geocode_district_centroid(district, state, user_lat, user_lon)
            src = "district_centroid" if lat_p else None
            cleaned = None
        else:
            cleaned = recommender.clean_address(raw_addr)
            lat_p, lon_p = recommender.geocode_geoapify(cleaned, user_lat, user_lon)
            if lat_p is not None:
                src = "geoapify"
            else:
                lat_p, lon_p = recommender.geocode_nominatim(cleaned)
                if lat_p is not None:
                    src = "nominatim"
                else:
                    lat_p, lon_p = recommender.geocode_district_centroid(district, state, user_lat, user_lon)
                    src = "district_centroid" if lat_p else None

        # store result into cache under lock
        if key:
            with cache_lock:
                cache[key] = {"lat": lat_p, "lon": lon_p, "source": src, "queried": cleaned, "ts": datetime.utcnow().isoformat()} if lat_p is not None else None

        # small sleep (same as original)
        time.sleep(0.1)

        d = recommender.haversine_km(user_lat, user_lon, lat_p, lon_p) if (user_lat is not None and lat_p is not None and lon_p is not None) else None
        return idx, d, lat_p, lon_p, src

    args_list = [ (i, row.get("address"), row.get("district"), row.get("state")) for i, row in top.iterrows() ]
    max_workers = min(6, max(1, len(args_list)))
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        for idx, d, lat_p, lon_p, src in ex.map(geocode_worker, args_list):
            distances.append(d)
            lats.append(lat_p)
            lons.append(lon_p)
            sources.append(src)

    # persist cache (same as original)
    recommender.save_geocache(cache)

    top["distance_km"] = distances
    top["lat"] = lats
    top["lon"] = lons
    top["geocode_source"] = sources

    # final sort: distance (ascending), then price (like the script)
    top = top.sort_values(by=["distance_km", "min_price"], na_position="last").reset_index(drop=True)

    # limit results
    top = top.head(req.max_results)

    # select columns for response
    display_cols = ["premise","min_price","distance_km","lat","lon","geocode_source","address","state","district","last_date"]

    # convert last_date to string where necessary
    top = top[display_cols].copy()
    top["last_date"] = top["last_date"].astype(str)

    # Convert to list of dicts for JSON response
    result = top.to_dict(orient="records")
    return result

@app.post("/generate-recipe")
def generate_recipe(req: RecipeRequest):
    return geminiRecipe.generate_recipes(req.items, req.user_prompt)

@app.post("/recipe-details")
def recipe_details(req: RecipeDetailsRequest):
    return geminiRecipe.get_recipe_details(req.recipe_name, req.items)

@app.post("/analyze-snapshot")
def analyze_snapshot(req: SnapshotRequest):
    return geminiRecipe.analyze_snapshot(req.image_base64)

@app.get("/api/location/name")
def get_location_name(lat: float, lon: float):
    """
    Reverse geocodes coordinates to a friendly display name.
    """
    try:
        from geopy.geocoders import Nominatim
        geolocator = Nominatim(user_agent="smartfridge_ai_2025")
        location = geolocator.reverse((lat, lon), exactly_one=True, timeout=5)
        if location:
            full_address = location.address
            addr_parts = full_address.split(', ')
            
            # If the first part is a specific venue (like a cafe, shop, etc.), remove it
            # Nominatim often puts the POI name as the first element
            raw_addr = location.raw.get('address', {})
            poi_keys = ['amenity', 'shop', 'tourism', 'leisure', 'office', 'highway']
            poi_name = None
            for key in poi_keys:
                if key in raw_addr:
                    poi_name = raw_addr[key]
                    break
            
            # If the first part matches a known POI name, strip it
            if len(addr_parts) > 1 and (poi_name and addr_parts[0].lower() == poi_name.lower()):
                full_address = ', '.join(addr_parts[1:])
            elif len(addr_parts) > 1 and raw_addr.get('house_number') is None and raw_addr.get('road'):
                 # Fallback: if first part isn't 'road' or 'house_number', it's likely a POI
                 if addr_parts[0] != raw_addr.get('road') and addr_parts[0] != raw_addr.get('postcode'):
                     full_address = ', '.join(addr_parts[1:])

            print(f"\n[Location Debug] Coordinates: {lat}, {lon}")
            print(f"[Location Debug] Full Address (Refined): {full_address}\n")
            
            addr = raw_addr
            # Try to build a concise name: Suburb/City, State
            city = addr.get('city') or addr.get('town') or addr.get('suburb') or addr.get('county')
            state = addr.get('state')
            
            concise_name = addr_parts[0]
            if city and state:
                concise_name = f"{city}, {state}"
                
            return {
                "name": concise_name,
                "fullAddress": full_address
            }
    except Exception as e:
        print(f"Reverse geocode error: {e}")
    
    return {"name": "Unknown Location", "fullAddress": None}

@app.get("/api/initial-state")
async def get_initial_state():
    """
    Returns the latest hydrated sensor and inventory state for first-load triggering.
    Ensures state is fresh by re-hydrating from Supabase first.
    """
    init_state_from_supabase()
    return latest_sensor_data

@app.post("/api/snapshot/trigger")
async def trigger_snapshot():
    """
    Manually triggers a hardware snapshot by publishing an MQTT command.
    """
    try:
        print("[API] Manual snapshot trigger received. Publishing MQTT command...")
        # Publish capture command to the hardware
        mqtt_client.publish("fridge/command", json.dumps({"command": "capture"}), qos=1)
        return {"status": "success", "message": "Manual snapshot trigger sent to hardware."}
    except Exception as e:
        print(f"[API] Error triggering snapshot: {e}")
        raise HTTPException(status_code=500, detail=str(e))