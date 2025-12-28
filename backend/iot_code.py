# main.py
import time
from datetime import datetime
import os
import json
import threading
import subprocess
from concurrent.futures import ThreadPoolExecutor
import requests
import queue
from supabase import create_client, Client

# sensors
import RPi.GPIO as GPIO
import board
import adafruit_dht
import mimetypes

# mqtt
import paho.mqtt.client as mqtt

# SUPABASE CONFIG
SUPABASE_URL = "https://likyygzbjgrzsdyzsira.supabase.co/"
SUPABASE_KEY = "sb_publishable_jU2_op2cAI7Fhbw9ygEt4g_hl-suGcf"
SUPABASE_BUCKET = "camera_images"
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
print("Successfully connected to Supabase!")

# ---------- CONFIG ----------
# GCP
DEVICE_ID = "fridge-01"
MQTT_BROKER = "104.198.67.66"
MQTT_PORT = 1883
MQTT_USER = "smartfridge"
MQTT_PASS = "password"
MQTT_BASE = f"fridge"
TELEMETRY_TOPIC = MQTT_BASE + "/telemetry"
DOOR_TOPIC = MQTT_BASE + "/door"
CAPTURE_TOPIC = MQTT_BASE + "/capture"
STATUS_TOPIC = MQTT_BASE + "/status"
COMMAND_TOPIC = MQTT_BASE + "/command"

LOCAL_IMAGE_DIR = "/home/lemon/IoT_Camera/snapshot"
os.makedirs(LOCAL_IMAGE_DIR, exist_ok=True)

# GPIO pins
IR_PIN = 24
LED_PIN = 18            # Physical Pin 12
LED_DURATION = 10       # Seconds to stay on for capture

# CircuitPython style
sensor = adafruit_dht.DHT11(board.D4)

# sensor timings
DHT_INTERVAL = 4.0      # seconds
TELEMETRY_INTERVAL = 30  # seconds
IR_DEBOUNCE = 0.3       # seconds

# thread pool
executor = ThreadPoolExecutor(max_workers=2)
upload_q = queue.Queue()  # local queued image paths for retry
dht_lock = threading.Lock()

# ---------- IR/countdown configuration ----------
COUNTDOWN_SECONDS = 5

# state vars for IR-driven countdown
door_opened_event = threading.Event()           # ADDED: Track if door was opened
countdown_cancel_event = threading.Event()      # ADDED: Track if countdown should stop
countdown_lock = threading.Lock()               # ADDED: Protect countdown thread management
countdown_thread = None                         # ADDED: Reference to active countdown
prev_door_closed = None                         # ADDED: For edge-trigger detection

# ---------- GPIO SETUP ----------
GPIO.setmode(GPIO.BCM)
GPIO.setup(IR_PIN, GPIO.IN)
GPIO.setup(LED_PIN, GPIO.OUT)
GPIO.output(LED_PIN, GPIO.LOW) # Ensure off initially

# ---------- MQTT SETUP ----------
client = mqtt.Client(client_id=DEVICE_ID, clean_session=True)
client.username_pw_set(MQTT_USER, MQTT_PASS)
client.will_set(STATUS_TOPIC, json.dumps({"ok": False, "ts": time.time()}), qos=1, retain=True)

def on_mqtt_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload.decode())
        command = payload.get("command")
        if command == "capture":
            print("[MQTT] Manual capture command received!")
            executor.submit(capture_and_upload)
    except Exception as e:
        print(f"[MQTT] Error processing command: {e}")

def mqtt_connect():
    client.on_message = on_mqtt_message
    client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
    client.subscribe(COMMAND_TOPIC)
    client.loop_start()
    client.publish(STATUS_TOPIC, json.dumps({"ok": True, "timestamp": time.time()}), qos=1, retain=True)

mqtt_connect()

# ---------- HELPERS ----------
def publish_telemetry(temp, hum):
    payload = {
        "device": DEVICE_ID,
        "temperature_celsius": round(temp, 1),
        "humidity_percent": int(hum),
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    client.publish(TELEMETRY_TOPIC, json.dumps(payload), qos=0)

def publish_door(state):
    payload = {
        "device": DEVICE_ID, 
        "state": state, 
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    # door is important state -> retain last value
    client.publish(DOOR_TOPIC, json.dumps(payload), qos=1, retain=True)

def publish_capture(image_url, local_name=None):
    payload = {
        "device": DEVICE_ID, 
        "image_url": image_url, 
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    if local_name:
        payload["local"] = local_name
    client.publish(CAPTURE_TOPIC, json.dumps(payload), qos=0)

# ---------- IMAGE CAPTURE & UPLOAD ----------
def capture_image():
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    filename = os.path.join(LOCAL_IMAGE_DIR, f"capture_{timestamp}.jpg")
    cmd = ["rpicam-still", "-t", "1", "-o", filename]
    try:
        subprocess.run(cmd, check=True, timeout=10)
        return filename
    except Exception as e:
        print("Capture failed:", e)
        return None

def _guess_content_type(path: str) -> str:
    ct, _ = mimetypes.guess_type(path)
    return ct or "application/octet-stream"

def upload_image_to_supabase(local_path: str) -> str | None:
    try:
        # User wants latest timestamp, so we use timestamped filenames in storage
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        remote_path = f"captures/capture_{timestamp}.jpg"
        content_type = _guess_content_type(local_path)
        with open(local_path, "rb") as file_obj:
            supabase.storage.from_(SUPABASE_BUCKET).upload(
                path=remote_path,
                file=file_obj,
                file_options={"content-type": content_type, "upsert": "true"}
            )
        url_data = supabase.storage.from_(SUPABASE_BUCKET).get_public_url(remote_path)
        image_url = url_data if isinstance(url_data, str) else url_data.get("publicUrl")
        return image_url
    except Exception as e:
        print(f"[Supabase Upload Error] {e}")
        return None

def lead_flash_timer():
    """Timer function to turn off LED after duration"""
    print(f"[LED] Flash ON for {LED_DURATION}s")
    GPIO.output(LED_PIN, GPIO.HIGH)
    time.sleep(LED_DURATION)
    GPIO.output(LED_PIN, GPIO.LOW)
    print("[LED] Flash OFF")

def capture_and_upload():
    # Trigger LED flash in a separate thread so it doesn't block capture/upload
    threading.Thread(target=lead_flash_timer, daemon=True).start()
    
    with dht_lock:
        local = capture_image()
    if not local:
        return
    url = upload_image_to_supabase(local)
    if url:
        publish_capture(url, local)
        try:
            os.remove(local)
        except Exception:
            pass
    else:
        print("Supabase upload failed — queueing for retry:", local)
        upload_q.put(local)
        publish_capture("", local)

def retry_uploader():
    while True:
        try:
            local = upload_q.get()
            for attempt in range(3):
                url = upload_image_to_supabase(local)
                if url:
                    publish_capture(url, local)
                    try:
                        os.remove(local)
                    except Exception:
                        pass
                    break
                time.sleep(5 * (attempt + 1))
            else:
                print("Requeueing failed upload:", local)
                upload_q.put(local)
                time.sleep(60)
        except Exception:
            time.sleep(5)

retry_thread = threading.Thread(target=retry_uploader, daemon=True)
retry_thread.start()

# ---------- IR countdown helper ----------
def countdown_and_capture(): # ADDED
    """Run countdown from 5->0. Cancel if re-opened. Snapshot on 0."""
    print(f"[IR] Countdown started: {COUNTDOWN_SECONDS}s")
    try:
        for remaining in range(COUNTDOWN_SECONDS, 0, -1):
            print(f"[IR] Countdown: {remaining}")
            # Check for cancellation frequently (every 0.1s)
            waited = 0.0
            while waited < 1.0:
                time.sleep(0.1)
                waited += 0.1
                if countdown_cancel_event.is_set():
                    print("[IR] Countdown cancelled (door opened)")
                    return
        
        print("[IR] Countdown reached 0 — capturing snapshot")
        # Snapshot triggered, call existing capture/upload non-blocking
        executor.submit(capture_and_upload)
        
        # Require a new open->close cycle for next countdown
        door_opened_event.clear() 
    finally:
        # Final cleanup for the countdown status
        countdown_cancel_event.clear()

# ---------- MAIN SENSOR LOOP ----------
def sensor_loop(): # CHANGED
    global prev_door_closed, countdown_thread

    last_dht = 0
    last_telemetry = 0
    last_temp = None
    last_hum = None
    last_ir_time = 0

    if prev_door_closed is None:
        prev_door_closed = (GPIO.input(IR_PIN) == GPIO.LOW)

    while True:
        now = time.time()
        door_closed = (GPIO.input(IR_PIN) == GPIO.LOW)

        # EDGE-TRIGGERED DOOR LOGIC
        if door_closed != prev_door_closed:
            # Only publish on actual state change
            state_str = "closed" if door_closed else "open"
            print(f"[IR] Transition detected: {state_str.upper()}")
            publish_door(state_str)
            
            # Transition: CLOSED -> OPEN
            if not door_closed: 
                print("[IR] Door OPENED — flagging state and cancelling countdown")
                door_opened_event.set()
                countdown_cancel_event.set() # Trigger cancellation if any
            
            # Transition: OPEN -> CLOSED
            else:
                print("[IR] Door CLOSED")
                if door_opened_event.is_set():
                    # Start countdown if it was opened previously
                    countdown_cancel_event.clear()
                    with countdown_lock:
                        if countdown_thread is None or not countdown_thread.is_alive():
                            countdown_thread = threading.Thread(target=countdown_and_capture, daemon=True)
                            countdown_thread.start()
                            print("[IR] Countdown thread started")

            prev_door_closed = door_closed

        # ---------- DHT sensor ----------
        if now - last_dht > DHT_INTERVAL:
            try:
                with dht_lock:
                    temperature = sensor.temperature
                    humidity = sensor.humidity

                if humidity is not None and temperature is not None:
                    if last_temp is None or abs(last_temp - temperature) >= 0.2 or (now - last_telemetry) > TELEMETRY_INTERVAL:
                        publish_telemetry(temperature, humidity)
                        last_temp, last_hum = temperature, humidity
                        last_telemetry = now
            except RuntimeError:
                pass
            except Exception as error:
                print("Unexpected DHT error:", error)
            last_dht = now

        time.sleep(0.05)

# run sensor loop
try:
    sensor_loop()
except KeyboardInterrupt:
    print("Shutting down")
finally:
    GPIO.cleanup()
    client.loop_stop()
    client.disconnect()
    executor.shutdown(wait=False)
