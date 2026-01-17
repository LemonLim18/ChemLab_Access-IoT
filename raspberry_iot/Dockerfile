FROM python:3.11-bookworm

ENV PYTHONUNBUFFERED=1

# Install ONLY what Python actually needs
RUN apt-get update && apt-get install -y \
    gcc \
    python3-dev \
    libjpeg62-turbo-dev \
    libopenjp2-7 \
    libtiff-dev \
    libgpiod-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "iot_code.py"]