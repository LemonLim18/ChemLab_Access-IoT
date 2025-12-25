import requests
import os
from dotenv import load_dotenv
from geopy.geocoders import Nominatim

# Load environment variables from .env file
load_dotenv()

GEOAPIFY_API_KEY = os.environ.get("GEOAPIFY_API_KEY")

def geocode_geoapify(address):
    if not GEOAPIFY_API_KEY:
        return None, None
    url = "https://api.geoapify.com/v1/geocode/search"
    params = {"text": address, "apiKey": GEOAPIFY_API_KEY}
    try:
        resp = requests.get(url, params=params, timeout=10).json()
        if resp.get("features"):
            coords = resp["features"][0]["properties"]
            return coords["lat"], coords["lon"]
    except Exception:
        pass
    return None, None

def geocode_nominatim(address):
    geolocator = Nominatim(user_agent="smartfridge_geocoder")
    try:
        loc = geolocator.geocode(address, timeout=10)
        if loc:
            return loc.latitude, loc.longitude
    except Exception:
        pass
    return None, None

def geocode_address(address):
    # Try Geoapify first
    lat, lon = geocode_geoapify(address)
    if lat is not None:
        return lat, lon
    
    # Fallback to Nominatim
    return geocode_nominatim(address)

if __name__ == "__main__":
    address = input("Enter address or business name: ")
    lat, lon = geocode_address(address)
    if lat is not None:
        print(f"Lat, Lon: {lat} {lon}")
    else:
        print("Location not found.")

# from geopy.geocoders import Nominatim

# def geocode_text(query):
#     geolocator = Nominatim(user_agent="text_to_latlon_app")
#     try:
#         loc = geolocator.geocode(query, timeout=10)
#         if loc:
#             return loc.latitude, loc.longitude
#     except:
#         pass
#     return None, None


# if __name__ == "__main__":
#     text = input("Enter address or place name: ").strip()

#     # Fallback: try broader area if full name fails
#     lat, lon = geocode_text(text)

#     if lat is None:
#         print("Exact location not found, trying area-level geocoding...")
#         parts = text.split(",")
#         if len(parts) >= 3:
#             fallback = ", ".join(parts[-3:])  # district, state, country
#             lat, lon = geocode_text(fallback)

#     if lat is not None:
#         print(f"Latitude: {lat}")
#         print(f"Longitude: {lon}")
#     else:
#         print("Location not found.")
