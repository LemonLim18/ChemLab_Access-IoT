#include <WiFi.h>
#include <PubSubClient.h>

#define WIFI_SSID     "Joshua_2025@unifi"
#define WIFI_PASSWORD "Elephant18!"

// MQTT Config
const char* mqtt_server = "104.198.67.66";
const int mqtt_port = 1883;
const char* mqtt_user = "smartfridge";
const char* mqtt_pass = "password";

WiFiClient espClient;
PubSubClient client(espClient);

// Pin where the sensor signal is connected
const int waterPin = A3;

// Threshold for water detection (2000 as requested by user)
const int waterThreshold = 2000;

unsigned long lastMsg = 0;

void setup_wifi() { 
  delay(10); 
  Serial.println(); 
  Serial.print("Connecting to "); 
  Serial.println(WIFI_SSID); 
  WiFi.mode(WIFI_STA); 
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD); 
  while (WiFi.status() != WL_CONNECTED) { 
    delay(500); 
    Serial.print("."); 
  } 
  Serial.println("\nWiFi connected"); 
}

void reconnect() {
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    if (client.connect("WaterStatusSensor", mqtt_user, mqtt_pass)) {
      Serial.println("connected");
    } else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  setup_wifi();
  client.setServer(mqtt_server, mqtt_port);
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();

  unsigned long now = millis();
  // Publish every 60 seconds (1 minute)
  if (now - lastMsg > 10000) {
    lastMsg = now;
    
    // read analog voltage (0–4095 on ESP32 ADC)
    int sensorValue = analogRead(waterPin);
    Serial.print("Raw analog value: ");
    Serial.println(sensorValue);

    // Determine status
    String status = (sensorValue > waterThreshold) ? "Defreeze" : "Frozen";

    // Create JSON payload
    String payload = "{\"status\":\"" + status + "\"}";
    
    Serial.print("Publishing message: ");
    Serial.println(payload);
    // Updated topic to match backend shift
    client.publish("fridge/freeze", payload.c_str());

    // Local serial monitor status
    if (status == "Defreeze") {
      Serial.println("🔥 MELTING DETECTED!");
    } else {
      Serial.println("❄️ Freezer status: Frozen");
    }
  }
}