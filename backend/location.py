# location.py
import asyncio
import winsdk.windows.devices.geolocation as wdg
from geopy.geocoders import Nominatim

async def get_precise_coords():
    print("Geocoding: Requesting precise location...")
    locator = wdg.Geolocator()
    locator.desired_accuracy = wdg.PositionAccuracy.HIGH
    pos = await locator.get_geoposition_async()
    print("Geocoding: Location obtained.")
    return pos.coordinate.latitude, pos.coordinate.longitude

def get_user_location():
    """
    Returns (lat, lon)
    """
    lat, lon = asyncio.run(get_precise_coords())
    return lat, lon

def main():
    try:
        lat, lon = get_user_location()
        print(f"Precise Latitude: {lat}, Longitude: {lon}")

        geolocator = Nominatim(user_agent="my_locator_app_2025")
        location = geolocator.reverse((lat, lon), exactly_one=True)
        addr = location.raw.get('address', {})

        parts = [
            addr.get('road'),
            addr.get('suburb'),
            addr.get('county'),
            addr.get('state'),
            addr.get('postcode'),
            addr.get('country')
        ]

        clean_address = ", ".join([p for p in parts if p])
        print("Address:", clean_address if clean_address else "Address not found")

    except PermissionError:
        print("Enable location services in Windows Settings.")

if __name__ == "__main__":
    main()
