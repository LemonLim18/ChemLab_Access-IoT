import requests

def geocode_geoapify(address, api_key):
    url = "https://api.geoapify.com/v1/geocode/search"
    params = {"text": address, "apiKey": api_key}
    resp = requests.get(url, params=params).json()
    if resp.get("features"):
        coords = resp["features"][0]["properties"]
        return coords["lat"], coords["lon"]
    return None, None

if __name__ == "__main__":
    key = "b69735c7054048e3823a86c2dc65cba5"
    address = input("Enter address or business name: ")
    lat, lon = geocode_geoapify(address, key)
    print("Lat, Lon:", lat, lon)

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
