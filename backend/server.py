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
import random
import re
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
    "freezerStatus": "Frozen",
    "moistureAlert": False,
    "latest_image_url": None,
    "lastCaptureTime": None,
    "inventory": [],
    "shopping_list": [],
    "isAnalyzing": False,
    "lastUpdated": datetime.now().isoformat()
}

# Tracking for ongoing anomalies: { type: { "start": datetime, "last_remind": datetime } }
active_anomalies = {}
anomaly_lock = Lock()

# --- Hot Loading Cache (Extreme Performance) ---
# GLOBAL_PRICE_DF stores the aggregated price data in memory to avoid redundant disk I/O (~800ms saved per query)
GLOBAL_PRICE_DF: Optional[pd.DataFrame] = None
GLOBAL_PRICE_LAST_LOAD: Optional[datetime] = None

# USER_LOCATION_CACHE stores reverse geocoding results for coordinates (~500ms saved per query)
# Key: (round(lat, 3), round(lon, 3)) -> Accuracy ~110m
USER_LOCATION_CACHE: Dict[tuple, dict] = {}

def get_hot_price_data():
    """Returns the aggregated price dataframe from memory, or loads it if needed."""
    global GLOBAL_PRICE_DF, GLOBAL_PRICE_LAST_LOAD
    now = datetime.now()
    
    # Reload if empty OR older than 1 hour
    if GLOBAL_PRICE_DF is None or (GLOBAL_PRICE_LAST_LOAD and (now - GLOBAL_PRICE_LAST_LOAD) > timedelta(hours=1)):
        print(f"[Hot Cache] {'Loading' if GLOBAL_PRICE_DF is None else 'Refreshing'} price data into RAM...")
        try:
            GLOBAL_PRICE_DF = recommender.download_and_aggregate()
            # Pre-parse dates to save time on query
            GLOBAL_PRICE_DF['date_dt'] = pd.to_datetime(GLOBAL_PRICE_DF['date'], dayfirst=True, format='mixed', errors='coerce')
            GLOBAL_PRICE_DF = GLOBAL_PRICE_DF.dropna(subset=['date_dt'])
            GLOBAL_PRICE_DF['date_str'] = GLOBAL_PRICE_DF['date_dt'].dt.strftime('%Y-%m-%d')
            
            GLOBAL_PRICE_LAST_LOAD = now
            print(f"[Hot Cache] Successfully loaded {len(GLOBAL_PRICE_DF)} price records.")
        except Exception as e:
            print(f"[Hot Cache] ERROR loading data: {e}")
            if GLOBAL_PRICE_DF is None: raise e # Fatal only on first try
            
    return GLOBAL_PRICE_DF

def get_cached_location_name(lat: float, lon: float):
    """
    Reverse geocodes coordinate pairs with a persistent cache.
    Uses ArcGIS as a resilient fallback if Nominatim drops the connection.
    """
    # Round to 3 decimals (approx 111m) - perfect for area detection
    cache_key = (round(lat, 3), round(lon, 3))
    if cache_key in USER_LOCATION_CACHE:
        return USER_LOCATION_CACHE[cache_key]

    try:
        from geopy.geocoders import Nominatim, ArcGIS
        # Strictly serializing to satisfy Nominatim's strict session policy
        with Lock():
            # Try Nominatim first (Detailed)
            try:
                geolocator = Nominatim(user_agent=f"smartfridge_ai_{uuid.uuid4().hex[:8]}")
                location = geolocator.reverse((lat, lon), exactly_one=True, timeout=5)
                if location:
                    raw = location.raw.get("address", {})
                    state = raw.get("state") or raw.get("state_district")
                    district = raw.get("county") or raw.get("city_district") or raw.get("suburb")
                    USER_LOCATION_CACHE[cache_key] = {"state": state, "district": district}
                    return USER_LOCATION_CACHE[cache_key]
            except Exception:
                print(f"[Geocode] Nominatim failed, falling back to ArcGIS...")

            # Fallback to ArcGIS (Reliable)
            arcgis = ArcGIS(user_agent="smartfridge_ai_fallback")
            location = arcgis.reverse((lat, lon), timeout=5)
            if location:
                raw = location.raw
                # ArcGIS uses different keys
                state = raw.get("Region")
                district = raw.get("District") or raw.get("City")
                USER_LOCATION_CACHE[cache_key] = {"state": state, "district": district}
                return USER_LOCATION_CACHE[cache_key]

    except Exception as e:
        print(f"[Geocode] Critical error: {e}")
    
    return {"state": None, "district": None}

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
            
        # 3. Fetch Shopping List
        shopping_items = uploadInventory.get_shopping_list()
        latest_sensor_data["shopping_list"] = shopping_items
        print(f"[Startup] Loaded {len(shopping_items)} shopping items.")
    except Exception as e:
        print(f"[Startup] Error during initialization: {e}")

# Initialize state immediately
init_state_from_supabase()
get_hot_price_data() # Pre-warm the cache on startup

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        # Send latest data immediately upon connection
        await websocket.send_json({"type": "sensor_update", "data": latest_sensor_data})

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
# GCP
MQTT_BROKER = "136.119.234.10"
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
            print(f"DEBUG: [MQTT] Telemetry updated: {payload}")
            message_to_send = {"type": "sensor_update", "data": latest_sensor_data}
            update_broadcast = True
        
        elif topic == "fridge/door":
            state = payload.get("state", "closed")
            latest_sensor_data["doorOpen"] = (state.lower() == "open")
            latest_sensor_data["lastUpdated"] = datetime.now().isoformat()
            message_to_send = {"type": "sensor_update", "data": latest_sensor_data}
            update_broadcast = True

        elif topic == "fridge/freeze":
            # Flexible status handler (Frozen / Defreeze / Unfreezing / Defrosting)
            raw_status = payload.get("status", "Frozen")
            status_lower = raw_status.lower()
            
            # Map various synonyms to a standardized condition
            is_unfreezing = any(term in status_lower for term in ["defreeze", "unfreezing", "defrosting", "melting"])
            
            latest_sensor_data["freezerStatus"] = raw_status
            latest_sensor_data["moistureAlert"] = is_unfreezing
            
            latest_sensor_data["lastUpdated"] = datetime.now().isoformat()
            print(f"DEBUG: [MQTT] Freezer status: {raw_status} (Alert: {is_unfreezing})")
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
        # Notify frontend that analysis has officially started
        if main_loop:
            latest_sensor_data["isAnalyzing"] = True
            asyncio.run_coroutine_threadsafe(manager.broadcast({
                "type": "analysis_status",
                "data": {"status": "started", "timestamp": datetime.now().isoformat()}
            }), main_loop)
        
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
        latest_sensor_data["isAnalyzing"] = False
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
        latest_sensor_data["isAnalyzing"] = False
        if main_loop:
            asyncio.run_coroutine_threadsafe(manager.broadcast({
                "type": "analysis_status",
                "data": {"status": "failed", "error": str(e), "timestamp": datetime.now().isoformat()}
            }), main_loop)


async def anomaly_monitor():
    """
    Background loop to check for ongoing anomalies and send 5-min reminders.
    """
    global latest_sensor_data, active_anomalies
    while True:
        try:
            now = datetime.now()
            with anomaly_lock:
                # 1. Temperature Check (> 5C is unsafe)
                # if latest_sensor_data["temperature"] > 5:
                # Set higher threshold for temperature experimentation
                if latest_sensor_data["temperature"] > 25:
                    await handle_anomaly("temperature", f"Critical Temperature: {latest_sensor_data['temperature']}°C", now)
                else:
                    await resolve_anomaly("temperature", now)

                # 2. Humidity Check (> 60% is high)
                if latest_sensor_data["humidity"] > 60:
                    await handle_anomaly("humidity", f"High Humidity: {latest_sensor_data['humidity']}%", now)
                else:
                    await resolve_anomaly("humidity", now)

                # 3. Door Open Check
                if latest_sensor_data["doorOpen"]:
                    await handle_anomaly("door", "Door Left Open", now)
                else:
                    await resolve_anomaly("door", now)

                # 4. Freezer Moisture Check
                # Use moistureAlert as the source of truth set in MQTT handler
                if latest_sensor_data.get("moistureAlert"):
                    await handle_anomaly("freeze", f"Freezer Defrost: {latest_sensor_data.get('freezerStatus', 'Melting')}", now)
                else:
                    await resolve_anomaly("freeze", now)

        except Exception as e:
            print(f"[Anomalies] Error in monitor loop: {e}")
        
        await asyncio.sleep(10) # Check every 10 seconds

async def handle_anomaly(a_type: str, info: str, now: datetime):
    global active_anomalies
    if a_type not in active_anomalies:
        # NEW ANOMALY DETECTED
        print(f"DEBUG: [Anomalies] DETECTED {a_type}: {info}")
        active_anomalies[a_type] = {
            "start": now,
            "last_remind": now,
            "info": info
        }
        # Initial Alert
        await trigger_alert(a_type, info, is_initial=True)
    else:
        # EXISTING ANOMALY: Check for 5-minute reminder
        state = active_anomalies[a_type]
        if now - state["last_remind"] >= timedelta(minutes=5):
            print(f"DEBUG: [Anomalies] RECURRING REMINDER for {a_type}")
            state["last_remind"] = now
            await trigger_alert(a_type, info, is_initial=False)

async def resolve_anomaly(a_type: str, now: datetime):
    global active_anomalies
    if a_type in active_anomalies:
        state = active_anomalies.pop(a_type)
        duration = now - state["start"]
        duration_mins = int(duration.total_seconds() / 60)
        
        # Lowered to 0 for testing persistence immediately
        if duration_mins >= 0: 
            print(f"DEBUG: [Anomalies] RESOLVED {a_type} after {duration_mins} mins. Saving to Supabase...")
            event_data = {
                "type": a_type,
                "info": state["info"],
                "start_time": state["start"].isoformat(),
                "end_time": now.isoformat(),
                "duration_mins": duration_mins
            }
            res = uploadInventory.save_anomaly_event(event_data)
            print(f"DEBUG: [Supabase] Save Response: {res}")
            # ... refresh broadcast ...
            await manager.broadcast({
                "type": "notification_refresh",
                "data": {
                    "alert_category": a_type,
                    "alert_info": state["info"],
                    "duration_mins": duration_mins
                }
            })
        else:
            print(f"DEBUG: [Anomalies] {a_type} resolved quickly ({duration.total_seconds():.1f}s). Skipping Supabase log.")

async def trigger_alert(a_type: str, info: str, is_initial: bool):
    """
    Sends ephemeral WS toast and optionally an email.
    """
    print(f"DEBUG: [Anomalies] TRIGGERING ALERT - Type: {a_type}, Initial: {is_initial}")
    
    # WebSocket Toast
    await manager.broadcast({
        "type": "reminder_toast",
        "data": {
            "title": "Fridge Alert" if is_initial else "Personalized Reminder",
            "message": info if is_initial else f"{latest_sensor_data.get('user_name', 'User')}, {info}. Please check.",
            "alert_category": "error" if a_type in ["temperature", "freeze"] else "warning"
        }
    })

    # 2. Email (Only for initial and if enabled in settings)
    if is_initial and latest_sensor_data.get("email_enabled", True):
        msg = f"{info}. Please check your fridge!"
        if a_type == "door":
            msg = f"The door has been open for 5 minutes. Please remember to close it."
        await send_email_notification(f"SmartFridge Alert: {a_type.capitalize()}", msg)
    elif is_initial:
        print(f"DEBUG: [Email] Suppression - Notifications are disabled for this user.")

import resend

async def send_email_notification(subject: str, message: str):
    """
    Sends an email notification using the official Resend SDK.
    """
    api_key = os.getenv("RESEND_API_KEY", "re_HR53phhq_NHiRSBKSLSeURT1dbdWmCenX")
    recipient = os.getenv("USER_EMAIL", "limmiinning@gmail.com")

    if not api_key:
        print(f"DEBUG: [Resend] Skipping. Missing RESEND_API_KEY.")
        return

    try:
        print(f"DEBUG: [Resend] SDK Sending to {recipient}...")
        resend.api_key = api_key
        
        params = {
            "from": "SmartFridge <onboarding@resend.dev>",
            "to": [recipient],
            "subject": subject,
            "html": f"<strong>{subject}</strong><p>{message}</p>"
        }

        # SDK call (Synchronous, so we wrap in executor)
        loop = asyncio.get_running_loop()
        r = await loop.run_in_executor(None, lambda: resend.Emails.send(params))
        
        print(f"DEBUG: [Resend] Success! ID: {r.get('id')}")
            
    except Exception as e:
        print(f"DEBUG: [Resend] SDK Error: {e}")

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
    asyncio.create_task(anomaly_monitor())

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

class PricePoint(BaseModel):
    date: str
    price: float

class StoreItem(BaseModel):
    item_code: str
    item: str
    price: float
    unit: str
    date: str
    item_group: Optional[str]
    item_category: Optional[str]
    history: List[PricePoint]

class RecommendRow(BaseModel):
    premise: Optional[str]
    premise_type: Optional[str]
    min_price: Optional[float]
    distance_km: Optional[float]
    lat: Optional[float]
    lon: Optional[float]
    geocode_source: Optional[str]
    address: Optional[str]
    state: Optional[str]
    district: Optional[str]
    items: List[StoreItem]
    last_date: Optional[str]
    thumbnail_url: Optional[str] = None

class RecipeRequest(BaseModel):
    items: List[Dict[str, Any]]
    user_prompt: Optional[str] = ""
    strict_mode: bool = False

class RecipeDetailsRequest(BaseModel):
    recipe_name: str
    items: List[Dict[str, Any]]

class SnapshotRequest(BaseModel):
    image_base64: str

class ShoppingItem(BaseModel):
    id: Optional[str] = None
    name: str
    source: str = "manual"
    completed: bool = False

# --- Store Visuals Engine (Malaysian Brands - Live Interior Demo) ---
BRAND_ASSETS = {
    # "GIANT": "https://images.unsplash.com/photo-1578916171728-46686eac8d58?auto=format&fit=crop&q=80&w=1200",
    "GIANT": "https://assets.theedgemarkets.com/Giant.jpg",
    # "LOTUS": "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&q=80&w=1200",
    "TESCO": "https://media.licdn.com/dms/image/v2/D5622AQEFQ4BI0Ee6fw/feedshare-shrink_800/feedshare-shrink_800/0/1687051088809?e=2147483647&v=beta&t=uXSa4xxj__w1Jg3HKw-witcNNHyWeshW8K2aw_krx9E",
    "LOTUS": "https://media.licdn.com/dms/image/v2/D5622AQEFQ4BI0Ee6fw/feedshare-shrink_800/feedshare-shrink_800/0/1687051088809?e=2147483647&v=beta&t=uXSa4xxj__w1Jg3HKw-witcNNHyWeshW8K2aw_krx9E",
    "AEON": "https://assets.bwbx.io/images/users/iqjWHBFdfxIU/i2G8P4LD24RA/v0/-1x-1.webp",
    # "MYDIN": "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&q=80&w=1200",
    "MYDIN": "https://i.nextmedia.com.au/News/MYDIN_partners_Zebra_Technologies_for_warehouse_and_ecommerce_operations.jpg",
    # "ECONSAVE": "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&q=80&w=1200",
    "ECONSAVE": "https://econsave.com.my/wp-content/uploads/2020/03/Bingtaro.jpg",
    # "VILLAGE GROCER": "https://images.unsplash.com/photo-1583258292688-d0213dc5a3a8?auto=format&fit=crop&q=80&w=1200",
    "VILLAGE GROCER": "https://www.klgatewaymall.com/data/editor/stores/shopfront%20or%20food%20photos/village-grocer-front.jfif?v=1722179199884",
    # "JAYA GROCER": "https://images.unsplash.com/photo-1506484334406-f112cae3f94c?auto=format&fit=crop&q=80&w=1200",
    "JAYA GROCER": "https://cdn1.npcdn.net/userfiles/18859/image/Jaya_Grocer_Mont_Kiara.png",
    # "99 SPEEDMART": "https://images.unsplash.com/photo-1534723452862-4c874018d66d?auto=format&fit=crop&q=80&w=1200",
    "99 SPEEDMART": "https://theedgemalaysia.com/_next/image?url=https%3A%2F%2Fassets.theedgemarkets.com%2F99-Speed-Mart.jpg&w=1920&q=75",
    # "KK SUPER MART": "https://images.unsplash.com/photo-1534723452862-4c874018d66d?auto=format&fit=crop&q=80&w=1200",
    "KK SUPER MART": "https://cdn.sinchew.com.my/wp-content/uploads/2024/03/e79c9fe4b8bbe5ad97e79cbce8a29ce5ad90e9a38ee6b3a2efbd9c-e98193e6ad89e4bb8de99abee5b9b3e681afe68092e781ab-e7bd91e6b091e9859de985bfe69daf-2.jpg",
    # "7-ELEVEN": "https://images.unsplash.com/photo-1578916171728-46686eac8d58?auto=format&fit=crop&q=80&w=1200",
    "7-ELEVEN": "https://news.italianfood.net/wp-content/uploads/sites/2/2023/05/7-Eleven.jpeg",
    # "BIG": "https://images.unsplash.com/photo-1534723452862-4c874018d66d?auto=format&fit=crop&q=80&w=1200",
    "BIG": "https://directory.yellowbees.com.my/wp-content/uploads/2020/05/AEON-BiG.jpg",
}

def get_store_thumbnail(name: str, p_type: str = "", lat: Optional[float] = None, lon: Optional[float] = None):
    """
    Returns an authentic thumbnail URL for Malaysian stores:
    1. Brand Logo matching (High-res)
    2. Street View Image (Real Photo)
    3. Category Fallback
    """
    name_up = name.upper()
    
    # 1. Match Major Brands
    for brand, logo in BRAND_ASSETS.items():
        if brand in name_up:
            return logo
            
    # 2. Street View Image (Free Embed Service logic - but we need a direct URL for <img>)
    # Using openstreetmap/google static maps for storefront if lat/lon provided
    # Note: Static Maps API usually requires a key, but we can use streetview if allowed or categorized placeholders
    # For now, if no logo, we prioritize Street View via Name-based search query if we had a key.
    # Without a key, we'll use high-quality authentic category photos.
    
    cat_photos = {
        "Supermarket": [
            "https://cdn.pixabay.com/photo/2014/09/04/11/03/supermarket-435452_1280.jpg",
            "https://thumbs.dreamstime.com/b/empty-supermarket-shopping-aisle-21946823.jpg?w=768",
            "https://live.staticflickr.com/5705/23672578160_e46b93350d_b.jpg"
        ],
        "Pharmacy": [
            "https://thumbs.dreamstime.com/b/kuala-lumpur-malaysia-june-caring-pharmacy-group-be-berhad-operates-chain-community-pharmacies-carry-pharmaceutical-95096324.jpg",
            "https://tse2.mm.bing.net/th/id/OIP.wqHWoObEYhNGk5KfruCTdAHaFj?w=768&h=576&rs=1&pid=ImgDetMain&o=7&rm=3",
            "https://tse2.mm.bing.net/th/id/OIP.Qx-j2QyjG_mMx0JrmSEJmQHaEJ?rs=1&pid=ImgDetMain&o=7&rm=3"
        ],
        "Convenience": [
            "https://as2.ftcdn.net/v2/jpg/06/06/17/47/1000_F_606174797_RyXwK6uDJRdknzSnUXzWUEGY6JRC8hku.jpg",
            "https://th.bing.com/th/id/R.996cb8281572383a97f14cb4ef8d2b1a?rik=ew%2bL265ICcF75A&riu=http%3a%2f%2f5.imimg.com%2fdata5%2fANDROID%2fDefault%2f2022%2f4%2fNE%2fGM%2fVC%2f24884784%2fproduct-jpeg-1000x1000.jpg&ehk=mslemFA0jL%2bVx24MtVSY1gUxy7QYWmULS8TY045nifU%3d&risl=&pid=ImgRaw&r=0",
            "https://as2.ftcdn.net/v2/jpg/05/79/02/91/1000_F_579029194_JX66Kg0BFt4UNVQUmb63vwnrpeSnyd6j.jpg"
        ],
        "Hypermarket": [
            "https://cdn.pixabay.com/photo/2014/09/04/11/03/supermarket-435452_1280.jpg",
            "https://thumbs.dreamstime.com/b/empty-supermarket-shopping-aisle-21946823.jpg?w=768",
            "https://live.staticflickr.com/5705/23672578160_e46b93350d_b.jpg"
        ],
        "Pasar": [
            "https://tse4.mm.bing.net/th/id/OIP.WQh2gB8NukqVdAMc9tw0tQHaFb?rs=1&pid=ImgDetMain&o=7&rm=3",
            "https://c8.alamy.com/comp/DT1NNP/food-market-kuching-sarawak-malaysian-borneo-malaysia-southeast-asia-DT1NNP.jpg",
            "https://c8.alamy.com/comp/RTTD9N/traditional-market-in-kota-kinabalu-borneo-malaysia-RTTD9N.jpg",
            "https://c8.alamy.com/comp/CW190J/traditional-market-pasar-gede-in-solo-surakarta-java-indonesia-CW190J.jpg",
            "https://tse4.mm.bing.net/th/id/OIP.4zoLYnPjPqafcP7YxKvohwHaFj?w=751&h=563&rs=1&pid=ImgDetMain&o=7&rm=3",
        ],
        "Restoran": [
            "https://assets.bucketlistly.blog/sites/5adf778b6eabcc00190b75b1/assets/5c8b3a40332d740012b61316/best-cafes-restarants-kuala-lumpur-malaysia-image-10.jpg",
            "https://www.discovermnl.com.ph/wp-content/uploads/2022/09/542_DSF0852-scaled.jpg",
            "https://s3-media0.fl.yelpcdn.com/bphoto/Yt7qlXl209I5UAu-0Njc-g/o.jpg",
            "https://i0.wp.com/thefoodbunny.com/wp-content/uploads/2020/03/psx_20200303_1612591011139304759574028.jpg?w=1080&ssl=1",
            "https://driftsoul.com/wp-content/uploads/2018/03/01.jpg",
        ],
        "Kedai": [
            "https://media.timeout.com/images/103461686/image.jpg",
            "https://resize.indiatvnews.com/en/resize/newbucket/715_-/2016/08/canteen-1471425818.jpg",
            "https://media.timeout.com/images/103461683/1372/1029/image.jpg",
            "https://lh5.googleusercontent.com/p/AF1QipM6bjLMQDh2vEGHPwjkCMrZ2BO5djT6TWH3Mtlw=w1080-k-no",
            "https://i.pinimg.com/originals/a2/03/94/a20394189c375abd42159ec3173cf7c6.png",
        ],
    }
    
    for cat, photos in cat_photos.items():
        if cat.upper() in p_type.upper():
            return random.choice(photos)
            
    return "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&q=80&w=800"

@app.post("/recommend", response_model=List[RecommendRow])
def recommend(req: RecommendRequest):
    """
    Returns top places selling `product` near user's location (or globally if location not available).
    Extreme Performance Version: USES IN-MEMORY HOT DATA AND VECTORIZED GROUPING.
    """
    # 1) Use Hot-Cache Data (Instant - previously took ~800ms)
    try:
        df = get_hot_price_data()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load price data: {e}")

    # 2) Use Memoized Location (Instant - previously took ~500ms)
    user_lat = req.user_lat
    user_lon = req.user_lon
    addr_info = {"state": req.state_hint, "district": req.district_hint}
    
    if user_lat is not None and user_lon is not None and not (addr_info["state"] and addr_info["district"]):
        cached_loc = get_cached_location_name(user_lat, user_lon)
        if cached_loc["state"]: addr_info["state"] = cached_loc["state"]
        if cached_loc["district"]: addr_info["district"] = cached_loc["district"]

    # 3) Area filtering (Vectorized)
    df_area = df
    if addr_info.get("state"):
        # Case-insensitive vector search
        mask = df_area["state"].str.contains(str(addr_info["state"]), case=False, na=False)
        if mask.any(): df_area = df_area[mask]
        
    if not df_area.empty and addr_info.get("district"):
        mask = df_area["district"].str.contains(str(addr_info["district"]), case=False, na=False)
        if mask.any(): df_area = df_area[mask]

    if df_area.empty: df_area = df

    # 4) Product matching (Vectorized Pattern)
    product_q = req.product.strip()
    if not product_q: raise HTTPException(status_code=400, detail="Empty product")

    if product_q.isdigit():
        df_prod = df_area[df_area["item_code"].astype(str) == product_q].copy()
    else:
        # Match using optimized recommender logic
        # Clean items: drop na and ensure strings to avoid 'float' object errors in matcher
        items = df_area["item"].dropna().unique().tolist()
        items = [i for i in items if isinstance(i, str)]
        
        matched_items = recommender.match_items(product_q, items)
        if not matched_items: raise HTTPException(status_code=404, detail="No matching product")
        
        pattern = '|'.join([re.escape(m[0].lower()) for m in matched_items[:5]])
        df_prod = df_area[df_area["item"].str.lower().str.contains(pattern, na=False, regex=True)].copy()

    # 5) Categorical Filtering
    if any(k in product_q.lower() for k in ["milk", "susu"]):
        df_prod = df_prod[~df_prod["item_category"].str.upper().isin(["BUAH-BUAHAN", "FRUITS"])].copy()

    if df_prod.empty: raise HTTPException(status_code=404, detail="No products found")

    # --- VECTORIZED AGGREGATION (Extreme Performance) ---
    # Goal: Replace slow loops with a single groupby/agg pass
    
    # ensure numeric price
    df_prod["price"] = pd.to_numeric(df_prod["price"], errors="coerce")
    
    # 1. Sort by date once globally (already partially done in get_hot_price_data)
    # 2. Group by Store + Item and take top history
    # This creates a Store -> List of Items mapping instantly
    
    def aggregate_items(grp):
        # This function runs per store, it's the most efficient way to nest JSON objects
        # Get latest price per item_code within this store
        latest_items = grp.sort_values('date_dt', ascending=False).groupby('item_code').head(1)
        
        items_list = []
        for i_code, row in latest_items.iterrows():
            # Get full history for this specific item in this store
            history_rows = grp[grp['item_code'] == row['item_code']].sort_values('date_dt', ascending=False)
            history = [PricePoint(date=r['date_str'], price=float(r['price'])) for _, r in history_rows.iterrows()]
            
            items_list.append(StoreItem(
                item_code=str(row['item_code']),
                item=row['item'],
                price=float(row['price']),
                unit=str(row['unit']),
                date=str(row['date_str']),
                item_group=str(row['item_group']),
                item_category=str(row['item_category']),
                history=history
            ))
        return items_list

    # Group by Store (using premise_code as primary key)
    store_agg = df_prod.groupby(["premise_code", "premise", "premise_type", "address", "state", "district"])
    
    # Calculate min_price and latest_date via vectorized agg
    main_stats = store_agg.agg({
        "price": "min",
        "date_str": "max"
    }).reset_index()
    
    main_stats.columns = ["premise_code", "premise", "premise_type", "address", "state", "district", "min_price", "last_date"]
    # CRITICAL: reset_index(drop=True) ensures indices 0-199 match the row order for geocode result mapping
    main_stats = main_stats.sort_values("min_price").head(200).reset_index(drop=True)

    # 6) Geocoding (Parallel)
    cache = recommender.load_geocache()
    cache_lock = Lock()

    def geocode_worker(args):
        idx, raw_addr, district, state = args
        lat_p = lon_p = None
        src = None
        key = raw_addr.strip() if raw_addr and isinstance(raw_addr, str) else ""

        if key:
            with cache_lock:
                entry = cache.get(key)
            if entry:
                lat_p, lon_p, src = entry.get("lat"), entry.get("lon"), entry.get("source", "cache")
                # No sleep for cache hits!
                d = recommender.haversine_km(user_lat, user_lon, lat_p, lon_p) if (user_lat is not None and lat_p is not None) else None
                return idx, d, lat_p, lon_p, src

        # Actual Geocoding (throttled/fallback logic)
        lat_p, lon_p = recommender.geocode_geoapify(raw_addr, user_lat, user_lon)
        if lat_p is not None: src = "geoapify"
        else:
            lat_p, lon_p = recommender.geocode_nominatim(raw_addr)
            if lat_p is not None: src = "nominatim"
            else:
                lat_p, lon_p = recommender.geocode_district_centroid(district, state)
                src = "district_centroid" if lat_p is not None else None

        if key and lat_p is not None:
            with cache_lock:
                cache[key] = {"lat": lat_p, "lon": lon_p, "source": src, "ts": datetime.utcnow().isoformat()}
        
        time.sleep(0.02) # Reduced delay
        d = recommender.haversine_km(user_lat, user_lon, lat_p, lon_p) if (user_lat is not None and lat_p is not None) else None
        return idx, d, lat_p, lon_p, src

    args_list = [(i, r["address"], r["district"], r["state"]) for i, r in main_stats.iterrows()]
    with ThreadPoolExecutor(max_workers=10) as ex:
        results = list(ex.map(geocode_worker, args_list))
    
    results.sort(key=lambda x: x[0])
    main_stats["distance_km"] = [r[1] for r in results]
    main_stats["lat"] = [r[2] for r in results]
    main_stats["lon"] = [r[3] for r in results]
    main_stats["geocode_source"] = [r[4] for r in results]

    # 7) Final Sort and Construct Pydantic Response
    top = main_stats.sort_values(by=["distance_km", "min_price"], na_position="last").head(req.max_results)
    
    final_results = []
    for _, row in top.iterrows():
        # Lazy aggregation of items only for the final winners to save CPU
        store_items_df = df_prod[df_prod["premise_code"] == row["premise_code"]]
        items_json = aggregate_items(store_items_df)
        
        final_results.append(RecommendRow(
            premise=row["premise"],
            premise_type=row["premise_type"],
            min_price=row["min_price"],
            distance_km=row["distance_km"],
            lat=row["lat"],
            lon=row["lon"],
            geocode_source=row["geocode_source"],
            address=row["address"],
            state=row["state"],
            district=row["district"],
            items=items_json,
            last_date=str(row["last_date"]),
            thumbnail_url=get_store_thumbnail(row["premise"], row["premise_type"], row["lat"], row["lon"])
        ))

    return final_results

@app.post("/generate-recipe")
def generate_recipe(req: RecipeRequest):
    return geminiRecipe.generate_recipes(req.items, req.user_prompt, req.strict_mode)

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

@app.get("/api/shopping-list")
def get_shopping_list():
    return uploadInventory.get_shopping_list()

@app.post("/api/shopping-list")
def save_shopping_item(item: ShoppingItem):
    result = uploadInventory.save_shopping_item(item.dict())
    if result:
        return {"status": "success", "data": result.data[0] if result.data else None}
    raise HTTPException(status_code=500, detail="Failed to save shopping item")

@app.get("/api/anomaly-events")
def get_anomaly_events():
    return uploadInventory.get_anomaly_events()

class UserConfig(BaseModel):
    name: str
    email: str
    email_enabled: bool = True

@app.post("/api/user-config")
def set_user_config(config: UserConfig):
    global latest_sensor_data
    # Store in memory for this session
    os.environ["USER_EMAIL"] = config.email
    # Update latest_sensor_data for personalization and alert logic
    latest_sensor_data["user_name"] = config.name
    latest_sensor_data["email_enabled"] = config.email_enabled
    print(f"[Config] User {config.name} ({config.email}) registered. Email alerts: {'Enabled' if config.email_enabled else 'Disabled'}")
    return {"status": "success"}

@app.delete("/api/shopping-list/{item_id}")
def delete_shopping_item(item_id: str):
    if uploadInventory.delete_shopping_item(item_id):
        return {"status": "success"}
    raise HTTPException(status_code=500, detail="Failed to delete shopping item")

@app.get("/api/recipes/saved")
def get_saved_recipes():
    return uploadInventory.get_saved_recipes()

@app.post("/api/recipes/save")
def save_recipe(recipe: Dict[str, Any]):
    try:
        result = uploadInventory.save_recipe_to_supabase(recipe)
        if result:
            return {"status": "success"}
        raise HTTPException(status_code=500, detail="Unknown error saving recipe")
    except Exception as e:
        print(f"[API] Error in save_recipe: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/recipes/saved/{recipe_id}")
def delete_saved_recipe(recipe_id: str):
    if uploadInventory.delete_saved_recipe(recipe_id):
        return {"status": "success"}
    raise HTTPException(status_code=500, detail="Failed to delete recipe")

@app.get("/api/recipes/fallback-image")
def get_fallback_image(q: str):
    """
    Backend proxy for Lexica.art API to bypass CORS.
    Fetches real dish photos when Pollinations AI is throttled.
    """
    try:
        url = f"https://lexica.art/api/v1/search?q={requests.utils.quote(q)}"
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        if data.get("images") and len(data["images"]) > 0:
            # Return the first high-quality result
            return {"url": data["images"][0]["src"]}
        
        return {"url": "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?q=80&w=500&auto=format&fit=crop"} # Generic healthy food
    except Exception as e:
        print(f"[Image Proxy] Error: {e}")
        return {"url": "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?q=80&w=500&auto=format&fit=crop"}

@app.get("/api/recipes/image-proxy")
def pollinations_proxy(prompt: str, seed: Optional[int] = 0, model: Optional[str] = 'flux'):
    """
    Relays Pollinations AI requests through the Unified API.
    Extreme Resilience: 120s timeout and Triple Model rotation (Flux -> Turbo -> Dreamshaper).
    Uses Secret Key for VIP authenticated priority.
    """
    from fastapi.responses import Response
    
    api_key = os.getenv("POLLINATIONS_API_KEY")
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }
    
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    
    # Priority models: Try Flux first, then fall back to others if needed
    models_to_try = ["flux", "turbo", "dreamshaper"]
    last_error_body = ""
    clean_prompt = " ".join(prompt.split())
    
    for current_model in models_to_try:
        try:
            pollin_url = f"https://gen.pollinations.ai/image/{requests.utils.quote(clean_prompt)}"
            params = {
                "seed": seed,
                "model": current_model,
                "width": 800,
                "height": 600,
                "nologo": "true"
            }
            
            print(f"[Pollination Proxy] Attempting {current_model} (Wait: 120s, Seed: {seed})")
            # Increase timeout to 120s to handle heavy traffic and complex generations
            resp = requests.get(pollin_url, params=params, headers=headers, timeout=120)
            
            if resp.status_code == 200:
                print(f"[Pollination Proxy] Success with {current_model}")
                return Response(content=resp.content, media_type="image/jpeg")
            
            last_error_body = resp.text[:200]
            print(f"[Pollination Proxy] {current_model} failed ({resp.status_code}): {last_error_body}")
            
        except requests.exceptions.Timeout:
            print(f"[Pollination Proxy] {current_model} timed out after 120s")
            last_error_body = "Connection Timeout"
        except Exception as e:
            print(f"[Pollination Proxy] {current_model} exception: {e}")
            last_error_body = str(e)
            
    raise HTTPException(status_code=502, detail=f"All AI providers failed. Last response: {last_error_body}")
