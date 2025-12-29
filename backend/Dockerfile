# Use a Python base image (slim version for smaller size)
FROM python:3.11-slim

# Install system dependencies for GPIO and Camera
RUN apt-get update && apt-get install -y \
    libgpiod-dev \
    python3-libgpiod \
    gcc \
    libc6-dev \
    # Camera dependencies (rpicam-still needs these)
    libcamera-apps-lite \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements and install dependencies
COPY requirements_iot.txt .
RUN pip install --no-cache-dir -r requirements_iot.txt

# Copy the rest of the application code
COPY iot_code.py .
COPY item_dictionary.py .

# Create directory for snapshots (though we usually map this to a volume)
RUN mkdir -p /tmp/fridge_snapshots

# Define default environment variables (can be overridden at runtime)
ENV MQTT_BROKER=104.198.67.66
ENV DEVICE_ID=fridge-01
ENV LOCAL_IMAGE_DIR=/tmp/fridge_snapshots

# Command to run the application
CMD ["python", "iot_code.py"]
