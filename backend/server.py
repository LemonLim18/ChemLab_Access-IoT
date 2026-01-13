# Chemical Lab Storage Container - Backend Server
# uvicorn server:app --host 0.0.0.0 --port 8000 --reload

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os
import json
import asyncio
import paho.mqtt.client as mqtt
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import requests
import base64
from datetime import datetime, timedelta
import uuid
from threading import Lock
import io

# Load environment variables
load_dotenv()

# ========== FACE RECOGNITION IMPORTS ==========
try:
    import face_recognition
    import numpy as np
    from PIL import Image
    FACE_RECOGNITION_AVAILABLE = True
    print("[FaceRec] face_recognition library loaded successfully")
except ImportError:
    FACE_RECOGNITION_AVAILABLE = False
    print("[FaceRec] WARNING: face_recognition library not available. Install with: pip install face_recognition")

# ========== SUPABASE ==========
from supabase import create_client, Client

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://likyygzbjgrzsdyzsira.supabase.co/")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "sb_publishable_jU2_op2cAI7Fhbw9ygEt4g_hl-suGcf")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ========== APP SETUP ==========
app = FastAPI(title="Chemical Lab Storage API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ========== ENVIRONMENT THRESHOLDS ==========
CHEMICAL_THRESHOLDS = {
    "temperature_max": 25,    # °C - max safe storage temp
    "temperature_min": 15,    # °C - min safe storage temp  
    "humidity_max": 60,       # % - prevent moisture damage
    "humidity_min": 30,       # % - prevent static buildup
}

# ========== STORAGE STATE ==========
lab_storage_state = {
    "temperature": 20.0,
    "humidity": 45,
    "door_locked": True,
    "last_access_time": None,
    "last_access_by": None,
    "intrusion_detected": False,
    "alert_active": False,
    "lastUpdated": datetime.now().isoformat(),
    "lastTemperatureUpdate": datetime.now().isoformat(),
    "lastHumidityUpdate": datetime.now().isoformat(),
    "door_closed_since": datetime.now().isoformat() if True else None # Assuming locked initially
}

# Access log (in-memory, persisted to Supabase)
access_log: List[Dict] = []

# Registered faces: {user_id: {"name": str, "encoding": np.array}}
registered_faces: Dict[str, Dict] = {}
faces_lock = Lock()

# Anomaly tracking
active_anomalies: Dict[str, Dict] = {}
anomaly_lock = Lock()

# ========== CONNECTION MANAGER (WebSocket) ==========
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        # Send current state on connect
        await websocket.send_json({"type": "state_update", "data": lab_storage_state})

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass

manager = ConnectionManager()

# ========== MQTT CONFIG ==========
MQTT_BROKER = os.getenv("MQTT_BROKER", "104.198.67.66")
MQTT_PORT = int(os.getenv("MQTT_PORT", 1883))
MQTT_USER = os.getenv("MQTT_USER", "chemlab")
MQTT_PASS = os.getenv("MQTT_PASS", "password")

main_loop = None

def on_connect(client, userdata, flags, rc):
    print(f"[MQTT] Connected with result code {rc}")
    client.subscribe("chemlab/#")

def on_message(client, userdata, msg):
    global lab_storage_state, main_loop
    try:
        payload = json.loads(msg.payload.decode())
        topic = msg.topic
        
        print(f"[MQTT] Received on {topic}: {payload}")
        
        if topic == "chemlab/telemetry":
            # Telemetry
            data_time = payload.get("timestamp", datetime.now().isoformat())
            
            if "temperature_celsius" in payload:
                lab_storage_state["temperature"] = payload["temperature_celsius"]
                lab_storage_state["lastTemperatureUpdate"] = data_time
                
            if "humidity_percent" in payload:
                lab_storage_state["humidity"] = payload["humidity_percent"]
                lab_storage_state["lastHumidityUpdate"] = data_time
                
            lab_storage_state["lastUpdated"] = datetime.now().isoformat()
            
            if main_loop:
                asyncio.run_coroutine_threadsafe(
                    manager.broadcast({"type": "state_update", "data": lab_storage_state}),
                    main_loop
                )
        
        elif topic == "chemlab/access":
            # Face recognition request from IoT device
            image_url = payload.get("image_url")
            if image_url and main_loop:
                asyncio.run_coroutine_threadsafe(
                    process_face_recognition(image_url),
                    main_loop
                )
        
        elif topic == "chemlab/status":
            door_state = payload.get("door_state")
            timestamp = payload.get("timestamp", datetime.now().isoformat())
            
            if door_state:
                was_locked = lab_storage_state["door_locked"]
                is_locked = (door_state == "locked")
                
                lab_storage_state["door_locked"] = is_locked
                
                # Track when door was closed
                if is_locked and not was_locked:
                    lab_storage_state["door_closed_since"] = timestamp
                elif not is_locked:
                    lab_storage_state["door_closed_since"] = None
                    
                lab_storage_state["last_access_by"] = payload.get("last_access_by")
                lab_storage_state["last_access_by"] = payload.get("last_access_by")
                lab_storage_state["last_access_time"] = payload.get("last_access_time")
                lab_storage_state["lastUpdated"] = datetime.now().isoformat()
                
                if main_loop:
                    asyncio.run_coroutine_threadsafe(
                        manager.broadcast({"type": "state_update", "data": lab_storage_state}),
                        main_loop
                    )
        
        elif topic == "chemlab/intrusion":
            lab_storage_state["intrusion_detected"] = True
            lab_storage_state["lastUpdated"] = datetime.now().isoformat()
            
            # Log the intrusion
            intrusion_event = {
                "id": str(uuid.uuid4()),
                "type": "intrusion",
                "message": payload.get("message", "Intrusion detected"),
                "timestamp": datetime.now().isoformat(),
                "resolved": False
            }
            
            if main_loop:
                asyncio.run_coroutine_threadsafe(
                    manager.broadcast({
                        "type": "security_alert",
                        "data": intrusion_event
                    }),
                    main_loop
                )
        
        elif topic == "chemlab/alert":
            alert_type = payload.get("alert_type")
            message = payload.get("message")
            
            if main_loop:
                asyncio.run_coroutine_threadsafe(
                    manager.broadcast({
                        "type": "alert",
                        "data": {
                            "alert_type": alert_type,
                            "message": message,
                            "timestamp": datetime.now().isoformat()
                        }
                    }),
                    main_loop
                )
                
    except Exception as e:
        print(f"[MQTT] Error processing message: {e}")

mqtt_client = mqtt.Client()
mqtt_client.username_pw_set(MQTT_USER, MQTT_PASS)
mqtt_client.on_connect = on_connect
mqtt_client.on_message = on_message

# ========== FACE RECOGNITION ==========
async def process_face_recognition(image_url: str):
    """Process face from captured image and authorize/deny access."""
    global lab_storage_state, access_log
    
    print(f"[FaceRec] Processing image: {image_url}")
    
    access_attempt = {
        "id": str(uuid.uuid4()),
        "timestamp": datetime.now().isoformat(),
        "image_url": image_url,
        "person_name": None,
        "authorized": False
    }
    
    try:
        if not FACE_RECOGNITION_AVAILABLE:
            print("[FaceRec] Library not available, denying access")
            access_attempt["person_name"] = "Unknown (Library Unavailable)"
            send_access_response(False, "Unknown", "error")
            await manager.broadcast({"type": "access_denied", "data": access_attempt})
            access_log.append(access_attempt)
            return
        
        # Fetch the image
        response = requests.get(image_url, timeout=10)
        if response.status_code != 200:
            print(f"[FaceRec] Failed to fetch image: {response.status_code}")
            send_access_response(False, "Image Error", "error")
            return
        
        # Load image for face recognition
        image = Image.open(io.BytesIO(response.content))
        image_array = np.array(image)
        
        # Find faces in the image
        face_locations = face_recognition.face_locations(image_array)
        
        if len(face_locations) == 0:
            print("[FaceRec] No face detected in image")
            access_attempt["person_name"] = "No Face Detected"
            send_access_response(False, "No Face", "no_face")
            await manager.broadcast({"type": "access_denied", "data": access_attempt})
            access_log.append(access_attempt)
            return
        
        # Get face encodings
        face_encodings = face_recognition.face_encodings(image_array, face_locations)
        
        if len(face_encodings) == 0:
            print("[FaceRec] Could not encode face")
            send_access_response(False, "Encoding Error", "error")
            return
        
        unknown_encoding = face_encodings[0]
        
        # Compare with registered faces
        with faces_lock:
            if len(registered_faces) == 0:
                print("[FaceRec] No registered faces, denying access")
                access_attempt["person_name"] = "Unknown (No Users Registered)"
                send_access_response(False, "Unknown", "unauthorized")
                await manager.broadcast({"type": "access_denied", "data": access_attempt})
                access_log.append(access_attempt)
                return
            
            for user_id, user_data in registered_faces.items():
                known_encoding = user_data["encoding"]
                matches = face_recognition.compare_faces([known_encoding], unknown_encoding, tolerance=0.6)
                
                if matches[0]:
                    # Face matched!
                    person_name = user_data["name"]
                    print(f"[FaceRec] ACCESS GRANTED to: {person_name}")
                    
                    access_attempt["person_name"] = person_name
                    access_attempt["authorized"] = True
                    
                    lab_storage_state["last_access_by"] = person_name
                    lab_storage_state["last_access_time"] = datetime.now().isoformat()
                    
                    send_access_response(True, person_name, "authorized")
                    await manager.broadcast({"type": "access_granted", "data": access_attempt})
                    access_log.append(access_attempt)
                    
                    # Save to Supabase
                    save_access_log(access_attempt)
                    return
        
        # No match found
        print("[FaceRec] No matching face found, ACCESS DENIED")
        access_attempt["person_name"] = "Unknown Person"
        send_access_response(False, "Unknown", "unauthorized")
        await manager.broadcast({"type": "access_denied", "data": access_attempt})
        access_log.append(access_attempt)
        save_access_log(access_attempt)
        
    except Exception as e:
        print(f"[FaceRec] Error during recognition: {e}")
        send_access_response(False, "Error", "error")
        access_attempt["person_name"] = f"Error: {str(e)}"
        access_log.append(access_attempt)

def send_access_response(authorized: bool, name: str, reason: str = "authorized"):
    """Send access response back to IoT device via MQTT.
    
    Reasons:
    - 'authorized': Face matched a registered user
    - 'no_face': No face was detected in the image
    - 'unauthorized': Face detected but doesn't match any registered user
    - 'error': An error occurred during processing
    """
    response = {
        "authorized": authorized,
        "name": name,
        "reason": reason,
        "timestamp": datetime.now().isoformat()
    }
    mqtt_client.publish("chemlab/access_response", json.dumps(response), qos=1)
    print(f"[MQTT] Sent access response: {response}")


def save_access_log(log_entry: Dict):
    """Save access log to Supabase."""
    try:
        supabase.table("access_logs").insert(log_entry).execute()
        print("[Supabase] Access log saved")
    except Exception as e:
        print(f"[Supabase] Error saving access log: {e}")

# ========== ANOMALY MONITOR ==========
async def anomaly_monitor():
    """Background loop to check for environmental anomalies."""
    global lab_storage_state, active_anomalies
    
    while True:
        try:
            now = datetime.now()
            
            with anomaly_lock:
                temp = lab_storage_state["temperature"]
                humidity = lab_storage_state["humidity"]
                
                # Temperature checks
                if temp > CHEMICAL_THRESHOLDS["temperature_max"]:
                    await handle_anomaly("temperature_high", f"Temperature too high: {temp}°C", now)
                elif temp < CHEMICAL_THRESHOLDS["temperature_min"]:
                    await handle_anomaly("temperature_low", f"Temperature too low: {temp}°C", now)
                else:
                    await resolve_anomaly("temperature_high", now)
                    await resolve_anomaly("temperature_low", now)
                
                # Humidity checks
                if humidity > CHEMICAL_THRESHOLDS["humidity_max"]:
                    await handle_anomaly("humidity_high", f"Humidity too high: {humidity}%", now)
                elif humidity < CHEMICAL_THRESHOLDS["humidity_min"]:
                    await handle_anomaly("humidity_low", f"Humidity too low: {humidity}%", now)
                else:
                    await resolve_anomaly("humidity_high", now)
                    await resolve_anomaly("humidity_low", now)
                    
        except Exception as e:
            print(f"[Anomaly] Error in monitor: {e}")
        
        await asyncio.sleep(10)

async def handle_anomaly(a_type: str, info: str, now: datetime):
    """Handle new or ongoing anomaly."""
    global active_anomalies
    
    if a_type not in active_anomalies:
        print(f"[Anomaly] DETECTED: {a_type} - {info}")
        active_anomalies[a_type] = {
            "start": now,
            "last_remind": now,
            "info": info
        }
        await trigger_alert(a_type, info, is_initial=True)
    else:
        state = active_anomalies[a_type]
        if now - state["last_remind"] >= timedelta(minutes=2):
            state["last_remind"] = now
            await trigger_alert(a_type, info, is_initial=False)

async def resolve_anomaly(a_type: str, now: datetime):
    """Resolve an anomaly when conditions return to normal."""
    global active_anomalies
    
    if a_type in active_anomalies:
        state = active_anomalies.pop(a_type)
        duration = now - state["start"]
        duration_mins = int(duration.total_seconds() / 60)
        
        print(f"[Anomaly] RESOLVED: {a_type} after {duration_mins} minutes")
        
        await manager.broadcast({
            "type": "anomaly_resolved",
            "data": {
                "alert_type": a_type,
                "duration_mins": duration_mins,
                "timestamp": now.isoformat()
            }
        })

async def trigger_alert(a_type: str, info: str, is_initial: bool):
    """Send alert via WebSocket."""
    await manager.broadcast({
        "type": "env_warning",
        "data": {
            "title": "Environment Alert" if is_initial else "Reminder",
            "message": info,
            "alert_type": a_type,
            "is_initial": is_initial,
            "timestamp": datetime.now().isoformat()
        }
    })

# ========== STARTUP/SHUTDOWN ==========
@app.on_event("startup")
async def startup_event():
    global main_loop
    main_loop = asyncio.get_running_loop()
    mqtt_client.connect_async(MQTT_BROKER, MQTT_PORT, 60)
    mqtt_client.loop_start()
    asyncio.create_task(anomaly_monitor())
    load_registered_faces()
    print("[Startup] Chemical Lab Storage Server ready!")

@app.on_event("shutdown")
async def shutdown_event():
    mqtt_client.loop_stop()
    mqtt_client.disconnect()
    print("[Shutdown] Server stopped")

def load_registered_faces():
    """Load registered faces from Supabase on startup."""
    global registered_faces
    
    try:
        result = supabase.table("registered_users").select("*").execute()
        
        if result.data:
            with faces_lock:
                for user in result.data:
                    if user.get("face_encoding"):
                        encoding = np.array(json.loads(user["face_encoding"]))
                        registered_faces[user["id"]] = {
                            "name": user["name"],
                            "encoding": encoding
                        }
            
            print(f"[Startup] Loaded {len(registered_faces)} registered faces")
    except Exception as e:
        print(f"[Startup] Error loading faces: {e}")

# ========== WEBSOCKET ENDPOINT ==========
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# ========== API MODELS ==========
class RegisterFaceRequest(BaseModel):
    name: str
    images: List[str] # List of base64 strings
    auth_user_id: Optional[str] = None  # Link to Supabase Auth user

class TriggerCommandRequest(BaseModel):
    command: str  # "capture", "lock", "unlock", "alert"

class UserConfig(BaseModel):
    name: str
    email: str
    email_enabled: bool = True

# ========== API ENDPOINTS ==========
@app.get("/api/state")
async def get_state():
    """Get current storage state."""
    return lab_storage_state

@app.get("/api/access-logs")
async def get_access_logs(limit: int = 50):
    """Get recent access attempts."""
    try:
        result = supabase.table("access_logs").select("*").order("timestamp", desc=True).limit(limit).execute()
        return result.data or []
    except Exception as e:
        print(f"[API] Error fetching access logs: {e}")
        return access_log[-limit:]  # Fallback to in-memory

@app.get("/api/registered-users")
async def get_registered_users():
    """Get list of registered users (without face encodings)."""
    try:
        result = supabase.table("registered_users").select("id, name, registered_at, face_image_url, auth_user_id").execute()
        return result.data or []
    except Exception as e:
        print(f"[API] Error fetching users: {e}")
        return []

@app.get("/api/user-face-status/{auth_user_id}")
async def get_user_face_status(auth_user_id: str):
    """Check if a Supabase Auth user has registered their face."""
    try:
        result = supabase.table("registered_users").select("id, name, face_image_url").eq("auth_user_id", auth_user_id).execute()
        if result.data and len(result.data) > 0:
            return {"has_face": True, "user": result.data[0]}
        return {"has_face": False, "user": None}
    except Exception as e:
        print(f"[API] Error checking face status: {e}")
        return {"has_face": False, "user": None}

@app.post("/api/register-face")
async def register_face(req: RegisterFaceRequest):
    """Register a new authorized user's face with multiple images."""
    global registered_faces
    
    if not FACE_RECOGNITION_AVAILABLE:
        raise HTTPException(status_code=500, detail="Face recognition library not available")
    
    if not req.images:
        raise HTTPException(status_code=400, detail="No images provided")

    try:
        valid_encodings = []
        user_id = str(uuid.uuid4())
        
        # Create a safe folder name from user's name
        safe_name = req.name.replace(" ", "_").lower()
        uploaded_urls = []
        
        # Process each image
        for i, img_b64 in enumerate(req.images):
            try:
                # Decode base64
                image_data = base64.b64decode(img_b64)
                image = Image.open(io.BytesIO(image_data))
                image_array = np.array(image)
                
                # Find face
                face_locations = face_recognition.face_locations(image_array)
                if len(face_locations) == 0:
                    print(f"[API] No face found in image {i+1}, skipping")
                    continue
                
                # Get encoding
                face_encodings = face_recognition.face_encodings(image_array, face_locations)
                if len(face_encodings) > 0:
                    valid_encodings.append(face_encodings[0])
                    
                    # Upload ALL valid images to user-specific folder
                    image_path = f"registered_faces/{safe_name}/{user_id}_{i+1}.jpg"
                    try:
                        supabase.storage.from_("camera_images").upload(
                            path=image_path,
                            file=image_data,
                            file_options={"content-type": "image/jpeg", "upsert": "true"}
                        )
                        url = supabase.storage.from_("camera_images").get_public_url(image_path)
                        uploaded_urls.append(url)
                        print(f"[API] Uploaded image {i+1} to {image_path}")
                    except Exception as upload_err:
                        print(f"[API] Upload error for image {i+1}: {upload_err}")
                        
            except Exception as e:
                print(f"[API] Error processing image {i+1}: {e}")
                continue

        # Use first uploaded image as profile pic
        saved_image_url = uploaded_urls[0] if uploaded_urls else None

        if not valid_encodings:
            raise HTTPException(status_code=400, detail="Could not detect a face in any of the provided images")
        
        # Compute average encoding
        avg_encoding = np.mean(valid_encodings, axis=0)
        
        # Save to database
        user_record = {
            "id": user_id,
            "name": req.name,
            "registered_at": datetime.now().isoformat(),
            "face_image_url": saved_image_url,
            "face_encoding": json.dumps(avg_encoding.tolist()),
            "auth_user_id": req.auth_user_id  # Link to Supabase Auth user
        }
        
        supabase.table("registered_users").insert(user_record).execute()
        
        # Update in-memory cache
        with faces_lock:
            registered_faces[user_id] = {
                "name": req.name,
                "encoding": avg_encoding
            }
        
        print(f"[API] Registered new user: {req.name} with {len(valid_encodings)} valid face samples")
        
        return {
            "status": "success",
            "user": {
                "id": user_id,
                "name": req.name,
                "face_image_url": saved_image_url
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[API] Error registering face: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/registered-users/{user_id}")
async def delete_user(user_id: str):
    """Remove a registered user."""
    global registered_faces
    
    try:
        supabase.table("registered_users").delete().eq("id", user_id).execute()
        
        with faces_lock:
            if user_id in registered_faces:
                del registered_faces[user_id]
        
        return {"status": "success"}
    except Exception as e:
        print(f"[API] Error deleting user: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/trigger")
async def trigger_command(req: TriggerCommandRequest):
    """Send command to IoT device."""
    try:
        mqtt_client.publish("chemlab/command", json.dumps({"command": req.command}), qos=1)
        return {"status": "success", "message": f"Command '{req.command}' sent"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/user-config")
def set_user_config(config: UserConfig):
    """Update user notification settings."""
    global lab_storage_state
    
    os.environ["USER_EMAIL"] = config.email
    lab_storage_state["user_name"] = config.name
    lab_storage_state["email_enabled"] = config.email_enabled
    
    print(f"[Config] User {config.name} ({config.email}) registered. Email alerts: {'Enabled' if config.email_enabled else 'Disabled'}")
    return {"status": "success"}

@app.get("/api/thresholds")
async def get_thresholds():
    """Get current environment thresholds."""
    return CHEMICAL_THRESHOLDS

@app.put("/api/thresholds")
async def update_thresholds(thresholds: Dict[str, float]):
    """Update environment thresholds."""
    global CHEMICAL_THRESHOLDS
    
    for key, value in thresholds.items():
        if key in CHEMICAL_THRESHOLDS:
            CHEMICAL_THRESHOLDS[key] = value
    
    return {"status": "success", "thresholds": CHEMICAL_THRESHOLDS}

@app.get("/api/security-events")
async def get_security_events(limit: int = 20):
    """Get recent security-related events."""
    try:
        result = supabase.table("security_events").select("*").order("timestamp", desc=True).limit(limit).execute()
        return result.data or []
    except Exception as e:
        print(f"[API] Error fetching security events: {e}")
        return []

# Simple health check
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "Chemical Lab Storage API",
        "mqtt_connected": mqtt_client.is_connected() if hasattr(mqtt_client, 'is_connected') else "unknown",
        "face_recognition_available": FACE_RECOGNITION_AVAILABLE,
        "registered_users": len(registered_faces)
    }
