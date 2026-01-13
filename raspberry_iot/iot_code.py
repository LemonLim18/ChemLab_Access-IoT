# iot_code.py - Chemical Lab Storage Container System
# For Raspberry Pi 2 Model B
# Components: Camera, DHT11, IR Sensor, Button, Red LED, Buzzer, Servo Motor

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
from dotenv import load_dotenv

# Load environment variables (check both .env and .env.iot)
if os.path.exists(".env.iot"):
    load_dotenv(".env.iot")
    print("[CONFIG] Loaded from .env.iot")
else:
    load_dotenv()
    print("[CONFIG] Loaded from .env (or using defaults)")

# Sensors & GPIO
import RPi.GPIO as GPIO
import board
import adafruit_dht
import mimetypes

# MQTT
import paho.mqtt.client as mqtt

# ========== SUPABASE CONFIG ==========
SUPABASE_URL = os.getenv("SUPABASE_URL", "https://likyygzbjgrzsdyzsira.supabase.co/")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "sb_publishable_jU2_op2cAI7Fhbw9ygEt4g_hl-suGcf")
SUPABASE_BUCKET = os.getenv("SUPABASE_BUCKET", "camera_images")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
print("[ChemLab] Successfully connected to Supabase!")

# ========== MQTT CONFIG ==========
DEVICE_ID = os.getenv("DEVICE_ID", "chemlab-storage-01")
MQTT_BROKER = os.getenv("MQTT_BROKER", "104.198.67.66")
MQTT_PORT = int(os.getenv("MQTT_PORT", 1883))
MQTT_USER = os.getenv("MQTT_USER", "chemlab")
MQTT_PASS = os.getenv("MQTT_PASS", "password")
MQTT_BASE = os.getenv("MQTT_BASE", "chemlab")

print(f"[CONFIG] MQTT Broker: {MQTT_BROKER}")

# MQTT Topics
TELEMETRY_TOPIC = f"{MQTT_BASE}/telemetry"
ACCESS_TOPIC = f"{MQTT_BASE}/access"
ACCESS_RESPONSE_TOPIC = f"{MQTT_BASE}/access_response"
INTRUSION_TOPIC = f"{MQTT_BASE}/intrusion"
ALERT_TOPIC = f"{MQTT_BASE}/alert"
STATUS_TOPIC = f"{MQTT_BASE}/status"
COMMAND_TOPIC = f"{MQTT_BASE}/command"

# ========== GPIO PIN CONFIGURATION ==========
# (Raspberry Pi 2 Model B - BCM Mode)
DHT_PIN = board.D27         # GPIO 27 - Physical Pin 13
IR_PIN = 24                 # GPIO 24 - Physical Pin 18
LED_PIN = 22                # GPIO 22 - Physical Pin 15
BUZZER_PIN = 25             # GPIO 25 - Physical Pin 22
BUTTON_PIN = 17             # GPIO 17 - Physical Pin 11
SERVO_PIN = 12              # GPIO 12 - Physical Pin 32 (PWM0)

# ========== TIMING CONFIG ==========
DHT_INTERVAL = float(os.getenv("DHT_INTERVAL", 4.0))
TELEMETRY_INTERVAL = float(os.getenv("TELEMETRY_INTERVAL", 30))
BUTTON_DEBOUNCE = float(os.getenv("BUTTON_DEBOUNCE", 0.3))
DOOR_OPEN_REMINDER_INTERVAL = 120  # 2 minutes - trigger alert if door not closed

# ========== LOCAL STORAGE ==========
LOCAL_IMAGE_DIR = os.getenv("LOCAL_IMAGE_DIR", "/tmp/chemlab_snapshots")
os.makedirs(LOCAL_IMAGE_DIR, exist_ok=True)

# ========== THREAD POOL & QUEUES ==========
executor = ThreadPoolExecutor(max_workers=3)
upload_q = queue.Queue()  # Queued image paths for retry
dht_lock = threading.Lock()

# ========== STATE VARIABLES ==========
door_locked = True  # True = servo at 0° (locked)
last_access_time = None
last_access_by = None
door_open_start_time = None  # Track when door was opened
alert_active = threading.Event()  # Prevent overlapping alerts
interrupt_error = False  # Track if GPIO interrupts failed

# ========== GPIO SETUP ==========
# Clean up any previous states before starting
GPIO.setmode(GPIO.BCM)
GPIO.cleanup() 

GPIO.setmode(GPIO.BCM)
GPIO.setwarnings(False)

# Input pins
GPIO.setup(IR_PIN, GPIO.IN)
GPIO.setup(BUTTON_PIN, GPIO.IN, pull_up_down=GPIO.PUD_UP)  # Pull-up for button
time.sleep(0.1) # Brief delay to stabilize pin state

# Output pins
GPIO.setup(LED_PIN, GPIO.OUT)
GPIO.setup(BUZZER_PIN, GPIO.OUT)
GPIO.setup(SERVO_PIN, GPIO.OUT)

# Initialize outputs to OFF
GPIO.output(LED_PIN, GPIO.LOW)
GPIO.output(BUZZER_PIN, GPIO.LOW)

# Servo PWM setup (50Hz for standard servo)
servo_pwm = GPIO.PWM(SERVO_PIN, 50)
servo_pwm.start(0)

# Buzzer PWM setup for volume control (Frequency 500Hz for deeper tone, Start 0%)
buzzer_pwm = GPIO.PWM(BUZZER_PIN, 500)
buzzer_pwm.start(0)

# DHT11 sensor (CircuitPython style)
dht_sensor = adafruit_dht.DHT11(DHT_PIN)

# ========== SERVO CONTROL ==========
def set_servo_angle(angle):
    """Set servo to specified angle (0-180 degrees)."""
    duty = 2 + (angle / 18)  # Convert angle to duty cycle
    GPIO.output(SERVO_PIN, True)
    servo_pwm.ChangeDutyCycle(duty)
    time.sleep(0.5)
    GPIO.output(SERVO_PIN, False)
    servo_pwm.ChangeDutyCycle(0)

def lock_door():
    """Lock the door (servo to 0 degrees)."""
    global door_locked
    print("[SERVO] Locking door...")
    set_servo_angle(0)
    door_locked = True
    publish_status("locked")

def unlock_door():
    """Unlock the door (servo to 90 degrees)."""
    global door_locked, last_access_time
    print("[SERVO] Unlocking door...")
    set_servo_angle(90)
    door_locked = False
    last_access_time = datetime.now()
    publish_status("unlocked")

# ========== ALERT SYSTEM ==========
def trigger_alert_pattern():
    """
    Trigger alert: LED flashes while buzzer plays loud siren tone.
    Uses PWM for a proper audible alarm sound.
    """
    if alert_active.is_set():
        print("[ALERT] Alert already active, skipping...")
        return
    
    alert_active.set()
    print("[ALERT] Triggering siren alert...")
    
    try:
        # Flash LED and sound buzzer 10 times (~5 seconds)
        for _ in range(10):
            # ON - LED on, buzzer at 50% duty cycle for loud tone
            GPIO.output(LED_PIN, GPIO.HIGH)
            buzzer_pwm.ChangeDutyCycle(50)  # 50% = loud, clear tone
            time.sleep(0.25)
            
            # OFF - LED off, buzzer silent
            GPIO.output(LED_PIN, GPIO.LOW)
            buzzer_pwm.ChangeDutyCycle(0)
            time.sleep(0.25)
        
    finally:
        # Ensure both are OFF
        GPIO.output(LED_PIN, GPIO.LOW)
        buzzer_pwm.ChangeDutyCycle(0)
        alert_active.clear()
        print("[ALERT] Siren complete.")






# ========== MQTT SETUP ==========
# Update to CallbackAPIVersion.VERSION2 to fix deprecation warning
try:
    client = mqtt.Client(callback_api_version=mqtt.CallbackAPIVersion.VERSION2, client_id=DEVICE_ID, clean_session=True)
except (AttributeError, TypeError):
    # Fallback for older paho-mqtt versions
    client = mqtt.Client(client_id=DEVICE_ID, clean_session=True)
client.username_pw_set(MQTT_USER, MQTT_PASS)
client.will_set(STATUS_TOPIC, json.dumps({"ok": False, "ts": time.time()}), qos=1, retain=True)

def on_mqtt_connect(client, userdata, flags, reason_code, properties=None):
    print(f"[MQTT] Connected with reason code {reason_code}")
    # Subscribe to relevant topics
    client.subscribe(COMMAND_TOPIC)
    client.subscribe(ACCESS_RESPONSE_TOPIC)
    print(f"[MQTT] Subscribed to {COMMAND_TOPIC}, {ACCESS_RESPONSE_TOPIC}")

def on_mqtt_message(client, userdata, msg):
    global last_access_by
    try:
        payload = json.loads(msg.payload.decode())
        topic = msg.topic
        print(f"[MQTT] Received on {topic}: {payload}")
        
        if topic == COMMAND_TOPIC:
            command = payload.get("command")
            if command == "capture":
                print("[MQTT] Manual capture command received!")
                executor.submit(capture_and_request_access)
            elif command == "lock":
                executor.submit(lock_door)
            elif command == "unlock":
                executor.submit(unlock_door)
            elif command == "alert":
                executor.submit(trigger_alert_pattern)
                
        elif topic == ACCESS_RESPONSE_TOPIC:
            # Face recognition response from backend
            authorized = payload.get("authorized", False)
            person_name = payload.get("name", "Unknown")
            
            if authorized:
                print(f"[ACCESS] GRANTED for: {person_name}")
                last_access_by = person_name
                executor.submit(unlock_door)
                # Auto-lock after 10 seconds
                threading.Timer(10.0, lock_door).start()
            else:
                print(f"[ACCESS] DENIED for: {person_name}")
                executor.submit(trigger_alert_pattern)
                publish_intrusion("Unauthorized face detected")
                
    except Exception as e:
        print(f"[MQTT] Error processing message: {e}")

def mqtt_connect():
    client.on_connect = on_mqtt_connect
    client.on_message = on_mqtt_message
    
    while True:
        try:
            print(f"[MQTT] Attempting to connect to {MQTT_BROKER}...")
            client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
            client.loop_start()
            break
        except Exception as e:
            print(f"[MQTT] Connection failed: {e}. Retrying in 5s...")
            time.sleep(5)
            
    # Publish online status
    client.publish(STATUS_TOPIC, json.dumps({
        "ok": True, 
        "device": DEVICE_ID,
        "timestamp": time.time()
    }), qos=1, retain=True)

# ========== MQTT PUBLISHING HELPERS ==========
def publish_telemetry(temp, hum):
    """Publish temperature and humidity data."""
    payload = {
        "device": DEVICE_ID,
        "temperature_celsius": round(temp, 1),
        "humidity_percent": int(hum),
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    client.publish(TELEMETRY_TOPIC, json.dumps(payload), qos=0)

def publish_access_attempt(image_url):
    """Publish access attempt with captured image."""
    payload = {
        "device": DEVICE_ID,
        "image_url": image_url,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    client.publish(ACCESS_TOPIC, json.dumps(payload), qos=1)

def publish_intrusion(message):
    """Publish intrusion alert."""
    payload = {
        "device": DEVICE_ID,
        "message": message,
        "door_locked": door_locked,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    client.publish(INTRUSION_TOPIC, json.dumps(payload), qos=1)

def publish_status(state):
    """Publish door lock status."""
    payload = {
        "device": DEVICE_ID,
        "door_state": state,
        "last_access_by": last_access_by,
        "last_access_time": last_access_time.strftime("%Y-%m-%d %H:%M:%S") if last_access_time else None,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    client.publish(STATUS_TOPIC, json.dumps(payload), qos=1, retain=True)

def publish_alert(alert_type, message):
    """Publish alert notification."""
    payload = {
        "device": DEVICE_ID,
        "alert_type": alert_type,
        "message": message,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    client.publish(ALERT_TOPIC, json.dumps(payload), qos=1)

# ========== IMAGE CAPTURE & UPLOAD ==========
def capture_image():
    """Capture image using Raspberry Pi camera."""
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    filename = os.path.join(LOCAL_IMAGE_DIR, f"access_{timestamp}.jpg")
    
    # Use rpicam-still for newer Pi OS or raspistill for older
    cmd = ["rpicam-still", "-t", "1", "-o", filename]
    try:
        subprocess.run(cmd, check=True, timeout=10)
        print(f"[CAMERA] Captured: {filename}")
        return filename
    except subprocess.CalledProcessError:
        # Fallback to raspistill for older systems
        cmd = ["raspistill", "-t", "1", "-o", filename]
        try:
            subprocess.run(cmd, check=True, timeout=10)
            print(f"[CAMERA] Captured (raspistill): {filename}")
            return filename
        except Exception as e:
            print(f"[CAMERA] Capture failed: {e}")
            return None
    except Exception as e:
        print(f"[CAMERA] Capture failed: {e}")
        return None

def _guess_content_type(path: str) -> str:
    ct, _ = mimetypes.guess_type(path)
    return ct or "application/octet-stream"

def upload_image_to_supabase(local_path: str) -> str | None:
    """Upload captured image to Supabase storage."""
    try:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        remote_path = f"access_captures/access_{timestamp}.jpg"
        content_type = _guess_content_type(local_path)
        
        with open(local_path, "rb") as file_obj:
            supabase.storage.from_(SUPABASE_BUCKET).upload(
                path=remote_path,
                file=file_obj,
                file_options={"content-type": content_type, "upsert": "true"}
            )
        
        url_data = supabase.storage.from_(SUPABASE_BUCKET).get_public_url(remote_path)
        image_url = url_data if isinstance(url_data, str) else url_data.get("publicUrl")
        print(f"[UPLOAD] Successfully uploaded: {image_url}")
        return image_url
    except Exception as e:
        print(f"[UPLOAD] Supabase error: {e}")
        return None

def capture_and_request_access():
    """
    Capture face image and send to backend for recognition.
    Called when button is pressed.
    """
    print("[ACCESS] Starting face capture sequence...")
    
    # Flash LED briefly to indicate capture in progress
    GPIO.output(LED_PIN, GPIO.HIGH)
    
    with dht_lock:
        local_path = capture_image()
    
    GPIO.output(LED_PIN, GPIO.LOW)
    
    if not local_path:
        print("[ACCESS] Failed to capture image")
        trigger_alert_pattern()
        return
    
    # Upload to Supabase
    image_url = upload_image_to_supabase(local_path)
    
    if image_url:
        # Publish access attempt - backend will respond on ACCESS_RESPONSE_TOPIC
        publish_access_attempt(image_url)
        print(f"[ACCESS] Sent for recognition: {image_url}")
        
        # Clean up local file
        try:
            os.remove(local_path)
        except Exception:
            pass
    else:
        print("[ACCESS] Upload failed, queuing for retry...")
        upload_q.put(local_path)
        trigger_alert_pattern()

# ========== UPLOAD RETRY THREAD ==========
def retry_uploader():
    """Background thread to retry failed uploads."""
    while True:
        try:
            local_path = upload_q.get()
            for attempt in range(3):
                image_url = upload_image_to_supabase(local_path)
                if image_url:
                    publish_access_attempt(image_url)
                    try:
                        os.remove(local_path)
                    except Exception:
                        pass
                    break
                time.sleep(5 * (attempt + 1))
            else:
                print(f"[RETRY] Failed after 3 attempts: {local_path}")
                upload_q.put(local_path)
                time.sleep(60)
        except Exception:
            time.sleep(5)

# ========== BUTTON HANDLER ==========
def button_callback(channel):
    """Handle button press to trigger face capture."""
    print("[BUTTON] Pressed! Initiating access request...")
    executor.submit(capture_and_request_access)

# Setup button interrupt (falling edge for pull-up)
try:
    GPIO.add_event_detect(
        BUTTON_PIN, 
        GPIO.FALLING, 
        callback=button_callback, 
        bouncetime=300  # Debounce 300ms
    )
except RuntimeError as e:
    print(f"[GPIO] Warning: Failed to add edge detection on BUTTON_PIN: {e}")
    print("[GPIO] Plan B: Enabling polling fallback for the button.")
    interrupt_error = True

# ========== MAIN SENSOR LOOP ==========
def sensor_loop():
    """Main loop for sensor monitoring and alert checking."""
    global door_open_start_time
    
    last_dht = 0
    last_telemetry = 0
    last_temp = None
    last_hum = None
    last_door_reminder = 0
    prev_ir_state = None
    prev_button_state = GPIO.HIGH # For polling fallback
    
    print("[LOOP] Starting sensor monitoring...")
    
    while True:
        now = time.time()
        
        # --- Button Polling Fallback ---
        if interrupt_error:
            try:
                button_state = GPIO.input(BUTTON_PIN)
                if button_state == GPIO.LOW and prev_button_state == GPIO.HIGH:
                    print("[BUTTON] Polled press detected!")
                    button_callback(BUTTON_PIN)
                    time.sleep(0.3) # Debounce
                prev_button_state = button_state
            except Exception as e:
                print(f"[BUTTON] Polling error: {e}")
        
        # --- IR Sensor (Door/Obstacle Detection) ---
        # IR sensor: LOW = obstacle detected (door object in place), HIGH = no obstacle
        ir_detected = GPIO.input(IR_PIN) == GPIO.LOW
        
        if prev_ir_state is not None and ir_detected != prev_ir_state:
            if not ir_detected and door_locked:
                # Obstacle removed but door is locked - possible intrusion attempt
                print("[IR] Possible intrusion detected - object removed while locked!")
                publish_intrusion("IR sensor triggered while door locked")
                executor.submit(trigger_alert_pattern)
            elif ir_detected and not door_locked:
                # Door closed after being unlocked
                door_open_start_time = None
                print("[IR] Door object detected - resetting reminder timer")
            elif not ir_detected and not door_locked:
                # Door opened (unlocked)
                door_open_start_time = now
                print("[IR] Door opened - starting reminder timer")
        
        prev_ir_state = ir_detected
        
        # --- Door Open Reminder (every 2 minutes) ---
        if door_open_start_time and not door_locked:
            time_open = now - door_open_start_time
            time_since_reminder = now - last_door_reminder
            
            if time_open >= DOOR_OPEN_REMINDER_INTERVAL and time_since_reminder >= DOOR_OPEN_REMINDER_INTERVAL:
                minutes_open = int(time_open / 60)
                print(f"[REMINDER] Door has been open for {minutes_open} minutes!")
                publish_alert("door_open", f"Door open for {minutes_open} minutes")
                executor.submit(trigger_alert_pattern)
                last_door_reminder = now
        
        # --- DHT11 Sensor (Temperature & Humidity) ---
        if now - last_dht > DHT_INTERVAL:
            try:
                with dht_lock:
                    temperature = dht_sensor.temperature
                    humidity = dht_sensor.humidity
                
                if humidity is not None and temperature is not None:
                    # Check for significant change or regular interval
                    should_publish = (
                        last_temp is None or 
                        abs(last_temp - temperature) >= 0.5 or 
                        (now - last_telemetry) > TELEMETRY_INTERVAL
                    )
                    
                    if should_publish:
                        publish_telemetry(temperature, humidity)
                        last_temp, last_hum = temperature, humidity
                        last_telemetry = now
                        
                        # Check for out-of-range conditions
                        if temperature > 25:
                            publish_alert("temperature_high", f"Temperature too high: {temperature}°C")
                        elif temperature < 15:
                            publish_alert("temperature_low", f"Temperature too low: {temperature}°C")
                            
                        if humidity > 60:
                            publish_alert("humidity_high", f"Humidity too high: {humidity}%")
                        elif humidity < 30:
                            publish_alert("humidity_low", f"Humidity too low: {humidity}%")
                            
            except RuntimeError:
                # DHT read errors are common, just skip
                pass
            except Exception as error:
                print(f"[DHT] Unexpected error: {error}")
            
            last_dht = now
        
        time.sleep(0.05)

# ========== STARTUP ==========
print("=" * 50)
print("  CHEMICAL LAB STORAGE CONTAINER SYSTEM")
print("  Raspberry Pi 2 Model B IoT Controller")
print("=" * 50)

# Connect to MQTT broker
mqtt_connect()

# Start background threads
retry_thread = threading.Thread(target=retry_uploader, daemon=True)
retry_thread.start()

# Initialize servo to locked position
lock_door()

# Run main loop
try:
    sensor_loop()
except KeyboardInterrupt:
    print("\n[SHUTDOWN] Received interrupt signal...")
finally:
    print("[CLEANUP] Cleaning up GPIO...")
    GPIO.cleanup()
    servo_pwm.stop()
    client.loop_stop()
    client.disconnect()
    executor.shutdown(wait=False)
    print("[SHUTDOWN] Complete.")
