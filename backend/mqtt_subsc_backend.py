# mqtt_subscriber.py
import json, time
import paho.mqtt.client as mqtt
from supabase import create_client
from datetime import datetime

# CONFIG
MQTT_BROKER = "104.198.67.66"   # your GCP VM IP (where mosquitto runs)
MQTT_PORT = 1883
MQTT_USER = "smartfridge"
MQTT_PASS = "password"

# SUPABASE_URL = "https://your-project.supabase.co"
# SUPABASE_KEY = "your-service-role-key"  # service role key or other key with insert/write
# supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# # simple helper to upsert latest state in Supabase
# def upsert_latest_telemetry(device, temp, hum, ts):
#     # table "latest_telemetry" with primary key device (create it beforehand)
#     row = {
#         "device": device,
#         "temperature_c": round(float(temp), 2),
#         "humidity_percent": int(hum),
#         "timestamp": ts.isoformat()
#     }
#     supabase.table("latest_telemetry").upsert(row, on_conflict="device").execute()

# # insert aggregated/minute samples to "telemetry_archive" (time-series)
# def insert_telemetry_archive(device, temp, hum, ts):
#     supabase.table("telemetry_archive").insert({
#         "device": device,
#         "temperature_c": round(float(temp),2),
#         "humidity_percent": int(hum),
#         "captured_at": ts.isoformat()
#     }).execute()

# message handler
def on_message(client, userdata, msg):
    try:
        payload = json.loads(msg.payload.decode())
    except Exception:
        print("bad payload", msg.topic, msg.payload)
        return

    if msg.topic == "fridge/telemetry":
        print("telemetry", payload)

    elif msg.topic == "fridge/capture":
        print("capture", payload)

    elif msg.topic == "fridge/door":
        print("door", payload)

def on_connect(client, userdata, flags, rc):
    print("connected to mqtt, rc=", rc)
    client.subscribe("fridge/#")

client = mqtt.Client()
client.username_pw_set(MQTT_USER, MQTT_PASS)
client.on_connect = on_connect
client.on_message = on_message
client.connect(MQTT_BROKER, MQTT_PORT)
client.loop_forever()