# Chemical Lab Storage Container System 🧪🔐

A secure IoT-based chemical storage access control system with **face recognition**, **environmental monitoring**, and **real-time alerts**.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🔐 **Face Recognition** | Multi-image biometric authentication using averaged face encodings for improved accuracy |
| 🌡️ **Environmental Monitoring** | Real-time temperature & humidity tracking with configurable thresholds |
| 🚨 **Security Alerts** | Synchronized LED + Buzzer alerts (5 cycles, 0.2s ON / 0.3s OFF) |
| 📱 **Web Dashboard** | Modern React dashboard with GSAP animations and hover modals |
| 🔒 **Servo Door Lock** | Automatic door control with 10-second auto-lock |
| 📊 **Access Logging** | Complete history stored in Supabase with real-time sync |
| 🔔 **Notification Center** | Slide-out panel for viewing system alerts and events |

---

## 🔄 User Workflow

The system is designed for secure, seamless access control:

1.  **Registration (One-time):**
    *   Admin accesses the Web Dashboard.
    *   Clicks "Add User" and uploads 3-5 photos of the authorized personnel.
    *   System computes an average biometric template and saves it to the database.

2.  **Access Request:**
    *   User walks up to the container and presses the **Physical Button**.
    *   **IoT Device** immediately captures a high-res photo.
    *   Photo is sent securely to the **Backend Server**.

3.  **Authentication & Action:**
    *   **Backend** compares the photo against all registered users.
    *   **If Match Found:**
        *   Server logs "Authorized Access".
        *   Sends `UNLOCK` command to IoT Device.
        *   **Door Unlocks** for 10 seconds.
    *   **If No Match:**
        *   Server logs "Access Denied".
        *   Sends `ALERT` command to IoT Device.
        *   **Red LED Flashes + Buzzer Sounds** to deter the user.

4.  **Monitoring:**
    *   Dashboard updates instantly with the new access log entry.
    *   If the door is left open for >2 minutes, the system triggers a "Door Open Warning" alert.

---

## 🤖 IoT Device Logic (Raspberry Pi)

The Raspberry Pi acts as the intelligent edge controller (`iot_code.py`):

*   **Telemetry Loop:** Reads Temperature (DHT11) and Humidity every 2 seconds and publishes to `chemlab/telemetry`.
*   **Event Listener:**
    *   **Button:** Triggers camera capture function.
    *   **IR Sensor:** Detects if an object (or door) is obstructing the opening. Used to track "Door Open" duration.
*   **Actuator Controller:**
    *   **Servo:** Rotates to 90° (Unlock) or 0° (Lock) based on MQTT commands. Includes a safety auto-lock timer.
    *   **Alert System:** Executes non-blocking threaded patterns for LED and Buzzer (e.g., rapid flash for intrusion, slow pulse for connection).

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Web Dashboard (React)                     │
│              http://localhost:5173                           │
│  • GSAP Animations    • Hover Modals    • Notification Center│
└──────────────────────────┬──────────────────────────────────┘
                           │ WebSocket + REST API
┌──────────────────────────▼──────────────────────────────────┐
│                  Backend Server (FastAPI)                    │
│              http://localhost:8000                           │
│  • Multi-Image Face Recognition    • Access Logging          │
│  • MQTT Handler                    • Anomaly Monitoring      │
│  • Supabase Integration            • Real-time WebSocket     │
└──────────────────────────┬──────────────────────────────────┘
                           │ MQTT (chemlab/*)
┌──────────────────────────▼──────────────────────────────────┐
│               Raspberry Pi 2 Model B                         │
│  • Pi Camera       • DHT11 (Temp/Humidity)                  │
│  • Button          • IR Sensor (Intrusion Detection)        │
│  • Servo Motor     • LED + Buzzer (Alerts)                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites
- Python 3.11+ (Miniconda recommended for Windows)
- Node.js 18+
- Raspberry Pi with camera module
- Supabase account

### Backend Server (Windows with Miniconda)

```bash
# Create environment with dlib support
conda create -n chemlab python=3.11 -y
conda activate chemlab
conda install -c conda-forge dlib -y

# Install dependencies
cd backend
pip install -r requirements.txt

# Start server
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### IoT Device (Raspberry Pi)

```bash
# Install dependencies
pip install -r requirements_iot.txt

# Create .env.iot with MQTT credentials
cp .env.iot.example .env.iot

# Run the IoT code
python iot_code.py
```

---

## 🔌 GPIO Pinout (Raspberry Pi 2 Model B)

| Component | GPIO Pin | Physical Pin | Notes |
|-----------|----------|--------------|-------|
| DHT11 Data | GPIO 27 | Pin 13 | 10kΩ pull-up resistor |
| Button | GPIO 17 | Pin 11 | Internal pull-up enabled |
| Red LED | GPIO 22 | Pin 15 | 220Ω current limiting resistor |
| IR Sensor | GPIO 24 | Pin 18 | 3.3V compatible module |
| Buzzer | GPIO 25 | Pin 22 | Active buzzer (PWM) |
| Servo | GPIO 12 | Pin 32 | PWM0 capable pin |

---

## 📡 MQTT Topics

| Topic | Direction | Payload |
|-------|-----------|---------|
| `chemlab/telemetry` | Pi → Backend | `{temperature_celsius, humidity_percent, timestamp}` |
| `chemlab/access` | Pi → Backend | `{image_url}` - Face capture for recognition |
| `chemlab/access_response` | Backend → Pi | `{authorized, name}` - Unlock/deny decision |
| `chemlab/status` | Pi → Backend | `{door_state, last_access_by}` |
| `chemlab/intrusion` | Pi → Backend | `{message}` - IR sensor alerts |
| `chemlab/command` | Backend → Pi | `{command: "capture"\|"lock"\|"unlock"}` |

---

## 🌡️ Environment Thresholds

| Parameter | Min | Max | Alert |
|-----------|-----|-----|-------|
| Temperature | 15°C | 25°C | Above/below triggers warning |
| Humidity | 30% | 60% | Above/below triggers warning |
| Door Open Reminder | - | 2 min | Alerts every 2 minutes if left open |

---

## 🔐 Face Recognition

The system uses **multi-image registration** for improved accuracy:

1. **Upload multiple photos** (3-5 recommended) of the same person
2. Backend detects faces in each image and extracts encodings
3. **Average encoding** is computed and stored
4. Images are saved to Supabase Storage in folders: `registered_faces/{user_name}/`

This approach provides robust recognition across different lighting conditions and angles.

---

## 📁 Project Structure

```
chemical_detector/
├── backend/
│   ├── server.py           # FastAPI server with face recognition
│   ├── requirements.txt    # Python dependencies
│   └── .env                # Supabase credentials
├── frontend/
│   ├── src/App.tsx         # Main React application
│   ├── types.ts            # TypeScript interfaces
│   └── constants.tsx       # Theme and initial state
├── raspberry_iot/
│   ├── iot_code.py         # Raspberry Pi IoT code
│   ├── requirements_iot.txt
│   ├── .env.iot            # MQTT credentials
│   └── info.md             # Hardware documentation
└── README.md
```

---

## 🛠️ Tech Stack

| Layer | Technologies |
|-------|--------------|
| **Frontend** | React 19, TypeScript, TailwindCSS, GSAP, SweetAlert2 |
| **Backend** | Python, FastAPI, face_recognition, paho-mqtt, Uvicorn |
| **Database** | Supabase (PostgreSQL + Storage) |
| **IoT** | Raspberry Pi 2 Model B, Python, RPi.GPIO, DHT11 |
| **Communication** | MQTT, WebSocket, REST API |

---

## ⚙️ Environment Variables

### Backend (.env)
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key
MQTT_BROKER=your-mqtt-broker-ip
MQTT_PORT=1883
```

### IoT Device (.env.iot)
```env
MQTT_BROKER=your-mqtt-broker-ip
MQTT_PORT=1883
MQTT_USER=your-username
MQTT_PASS=your-password
```

---

## 📜 License

MIT License - Feel free to use and modify!

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Submit a pull request

---

*Built with ❤️ for secure chemical storage management*
