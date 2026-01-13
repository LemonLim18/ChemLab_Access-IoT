# ===== Backend Dockerfile for ChemLab Access Control =====
# Optimized for GCP deployment with face_recognition support

FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for face_recognition (dlib), cmake, and build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    cmake \
    make \
    libc6-dev \
    libopenblas-dev \
    liblapack-dev \
    libx11-dev \
    libgtk-3-dev \
    libboost-python-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better Docker layer caching
COPY requirements.txt .

# Install Python dependencies
# Note: dlib compilation may take 5-10 minutes
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose the API port
EXPOSE 8000

# Environment variables with defaults (override at runtime with -e or docker-compose)
ENV MQTT_BROKER=34.45.208.206
ENV MQTT_PORT=1883
ENV MQTT_USER=""
ENV MQTT_PASS=""
ENV SUPABASE_URL=""
ENV SUPABASE_KEY=""

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run the FastAPI server
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
