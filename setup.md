# Chemical Lab Storage System - Setup Guide

This guide will help you set up the database and run the system.

## 1. Supabase Setup

You need to create two tables and one storage bucket in your Supabase project.

### SQL Tables
Run the following SQL in the **SQL Editor** of your Supabase dashboard:

```sql
-- 1. Create registered_users table for face biometric data
CREATE TABLE IF NOT EXISTS registered_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    registered_at TIMESTAMPTZ DEFAULT NOW(),
    face_image_url TEXT,
    face_encoding TEXT NOT NULL -- Stores the 128-d face encoding as a JSON array string
);

-- 2. Create access_logs table for tracking all attempts
CREATE TABLE IF NOT EXISTS access_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    person_name TEXT, -- Will be "Unknown" if unauthorized
    authorized BOOLEAN NOT NULL,
    image_url TEXT NOT NULL
);

-- 3. Create security_events table for intrusion alerts
CREATE TABLE IF NOT EXISTS security_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    type TEXT NOT NULL, -- 'intrusion', 'env_warning', etc.
    message TEXT NOT NULL,
    resolved BOOLEAN DEFAULT FALSE
);
```

### Storage Bucket
1. Go to **Storage** in Supabase.
2. Create a new bucket named **`camera_images`**.
3. Make it **Public** (so the frontend can display the images).

---

## 2. Environment Variables (.env)

Create a file named `.env` in the `backend/` folder and add your credentials:

```bash
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_service_role_key
RESEND_API_KEY=your_resend_api_key
USER_EMAIL=your_email@example.com
MQTT_BROKER=104.198.67.66
MQTT_USER=chemlab
MQTT_PASS=password
```

---

## 3. IoT Device Setup (Raspberry Pi)

Since your Pi handles the hardware, it needs its own set of files.

### 1. Transfer files to the Pi
Open a terminal on your PC and run these commands to copy the code and configuration:

```powershell
# Copy the IoT code
scp c:\Users\limmi\OneDrive\Desktop\chemical_detector\backend\iot_code.py lemon@192.168.1.162:/home/lemon/

# Copy the IoT dependencies list
scp c:\Users\limmi\OneDrive\Desktop\chemical_detector\backend\requirements_iot.txt lemon@192.168.1.162:/home/lemon/

# Copy the IoT environment variables
scp c:\Users\limmi\OneDrive\Desktop\chemical_detector\backend\.env.iot lemon@192.168.1.162:/home/lemon/.env
```

### 2. Connect to the Pi and Install
```bash
ssh lemon@192.168.1.162

# On the Pi:
pip install -r requirements_iot.txt
```

### 3. Run the IoT Code
```bash
python /home/lemon/iot_code.py
```

---

## 4. Running the Backend Server (PC)

---

## 4. Registering Your First User

Once the backend and frontend are running:
1. Open the dashboard (usually `http://localhost:5173`).
2. Go to the **Users** tab.
3. Click **Add User**.
4. Upload a clear photo of your face and enter your name.
5. The system will encode your face and save it to the database.

Now you can test the access flow!
