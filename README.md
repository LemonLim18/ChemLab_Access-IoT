# SmartFridge AI IoT 🧊🤖

A modern, AI-powered Smart Fridge ecosystem built for the ultimate kitchen management experience. This project integrates real-time IoT sensor monitoring, computer vision for inventory tracking, and a Gemini-powered Chef AI to suggest recipes based on what's actually in your fridge.

## 🚀 Key Features

- **🏠 Interactive Dashboard**: Monitor real-time telemetry from your fridge, including temperature, humidity, and door status.
- **📦 Smart Inventory Management**: Track food items with categories, stock levels, and automated expiry date estimations.
- **👨‍🍳 Gemini Chef AI**: Get creative recipe suggestions and detailed cooking instructions based on your available inventory and dietary preferences.
- **📸 IoT Snapshot Analysis**: Scan your fridge using AI to automatically identify and log new items (using Google Gemini 1.5 Flash).
- **🛒 Smart Shopping List**: automatically identifies low-stock items and helps you find the best stores to replenish them.
- **📍 Local Store Finder**: Connects with real-world price data (Hargapedia PriceCatcher) to find the nearest and cheapest stores for your groceries.

---

## 🛠️ Technology Stack

### Frontend
- **Framework**: [React](https://react.dev/) + [Vite](https://vitejs.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) + [DaisyUI](https://daisyui.com/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Charts**: [Recharts](https://recharts.org/)

### Backend
- **Framework**: [FastAPI](https://fastapi.tiangolo.com/) + [Uvicorn](https://www.uvicorn.org/)
- **AI/ML**: [Google Gemini AI (1.5 Flash)](https://ai.google.dev/)
- **Data Processing**: [Pandas](https://pandas.pydata.org/)
- **Geocoding**: [Geopy](https://geopy.readthedocs.io/) + [Geoapify API](https://www.geoapify.com/)
- **System**: Windows Geolocation Integration (via `winsdk`)

---

## ⚙️ Setup & Installation

### 1. Backend Setup

1.  **Navigate to the backend directory**:
    ```bash
    cd backend
    ```
2.  **Create and activate a virtual environment**:
    ```bash
    python -m venv .venv
    # Windows:
    .venv\Scripts\activate
    # macOS/Linux:
    source .venv/bin/activate
    ```
3.  **Install dependencies**:
    ```bash
    pip install -r requirements.txt
    ```
4.  **Configure Environment Variables**:
    Create a `.env` file in the `backend/` folder:
    ```env
    GEMINI_API_KEY=your_google_ai_api_key
    GEOAPIFY_API_KEY=your_geoapify_api_key (optional)
    ```
5.  **Run the FastAPI server**:
    ```bash
    uvicorn server:app --host 0.0.0.0 --port 8000 --reload
    ```

### 2. Frontend Setup

1.  **Navigate to the frontend directory**:
    ```bash
    cd frontend
    ```
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Configure Environment Variables**:
    Create a `.env` file in the `frontend/` folder:
    ```env
    VITE_API_BASE_URL=http://your_ip_address:8000
    ```
4.  **Run the development server**:
    ```bash
    npm run dev
    ```

---

## 📁 Project Structure

```text
├── backend/
│   ├── server.py           # FastAPI application & endpoints
│   ├── geminiRecipe.py     # Gemini AI logic for recipes & snapshots
│   ├── recommender.py      # Store recommendation engine
│   ├── location.py         # Windows Geolocation integration
│   ├── hargapedia_cli.py   # Price tracker data aggregator
│   └── .env                # Backend secrets
├── frontend/
│   ├── src/
│   │   ├── App.tsx         # Main application logic
│   │   ├── components/     # UI Components (Navbar, Cards, Modals)
│   │   ├── services/       # API interaction services
│   │   └── types.ts        # TypeScript interfaces
│   ├── tailwind.config.ts  # Design system configuration
│   └── .env                # Frontend configuration
└── README.md
```

## 🤝 Contributing

This project was developed for the **CST357 Real-time Systems & IoT** course. Contributions and improvements are welcome!

## 📄 License

This project is for educational purposes. All data sourced from [data.gov.my](https://data.gov.my) is subject to their licensing terms.
