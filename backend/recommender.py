# recommender.py
import os
import json
import time
import requests
import pandas as pd
from math import radians, sin, cos, sqrt, asin
from geopy.geocoders import Nominatim
from datetime import datetime
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
from matcher import match_items

from hargapedia_cli import download_and_aggregate
from location import get_user_location
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# ================= CONFIG =================
# Preferred: set your Geoapify API key in environment variable GEOAPIFY_API_KEY
# GEOAPIFY_API_KEY = os.getenv("GEOAPIFY_API_KEY")
GEOAPIFY_API_KEY = os.environ.get("GEOAPIFY_API_KEY")
GEOCACHE_FILE = os.path.join("csv_files", "geocache.json")
GEOCACHE_TTL_SECONDS = 60 * 60 * 24 * 365  # not used for expiry here, but reserved

# ---------- helpers ----------

def ensure_cache_dir():
    os.makedirs(os.path.dirname(GEOCACHE_FILE), exist_ok=True)

def load_geocache():
    ensure_cache_dir()
    if os.path.exists(GEOCACHE_FILE):
        try:
            with open(GEOCACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_geocache(cache):
    ensure_cache_dir()
    try:
        with open(GEOCACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

def clean_address(addr: str) -> str | None:
    """Clean and normalize an address string for geocoding."""
    if not addr or not isinstance(addr, str):
        return None
    s = addr.replace("\n", " ").replace("..", " ")
    # split on comma and strip each part; remove empty parts
    parts = [p.strip() for p in s.split(",") if p and p.strip()]
    if not parts:
        return None
    # join with single comma
    out = ", ".join(parts)
    # if country not present, add Malaysia to help geocoders
    if "malaysia" not in out.lower():
        out = f"{out}, Malaysia"
    return out

def haversine_km(lat1, lon1, lat2, lon2):
    """Straight-line (displacement) distance in KM using Haversine."""
    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = sin(dlat/2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon/2) ** 2
    c = 2 * asin(sqrt(a))
    return 6371.0 * c

# ---------------- Geoapify geocode (with bias) ----------------
def geocode_geoapify(address: str, user_lat: float | None = None, user_lon: float | None = None):
    """Query Geoapify for forward geocoding with optional proximity bias (user coords)."""
    if not address:
        return None, None
    url = "https://api.geoapify.com/v1/geocode/search"
    params = {"text": address, "apiKey": GEOAPIFY_API_KEY, "limit": 1}
    # bias by proximity (lon,lat) if provided
    if user_lat is not None and user_lon is not None:
        params["bias"] = f"proximity:{user_lon},{user_lat}"
    try:
        resp = requests.get(url, params=params, timeout=8)
        resp.raise_for_status()
        j = resp.json()
        feats = j.get("features") or []
        if feats:
            props = feats[0].get("properties", {})
            lat = props.get("lat")
            lon = props.get("lon")
            if lat is not None and lon is not None:
                return float(lat), float(lon)
    except Exception:
        pass
    return None, None

# ---------------- Nominatim fallback ----------------
def geocode_nominatim(address: str):
    if not address:
        return None, None
    geolocator = Nominatim(user_agent="recommender_geocoder")
    try:
        loc = geolocator.geocode(address, timeout=8)
        if loc:
            return float(loc.latitude), float(loc.longitude)
    except Exception:
        pass
    return None, None

# ---------------- district centroid fallback ----------------
def geocode_district_centroid(district: str, state: str, user_lat=None, user_lon=None):
    """Try geocoding 'district, state, Malaysia' as a fallback."""
    if not district and not state:
        return None, None
    parts = []
    if district:
        parts.append(district)
    if state:
        parts.append(state)
    parts.append("Malaysia")
    query = ", ".join(parts)
    lat, lon = geocode_geoapify(query, user_lat, user_lon)
    if lat is not None:
        return lat, lon
    return geocode_nominatim(query)

# ---------------- main single-address geocode with cache ----------------
def geocode_address_with_cache(raw_address: str, user_lat=None, user_lon=None, district=None, state=None, cache=None):
    """
    Use the cached mapping if available; otherwise:
      1) clean the address
      2) try Geoapify with proximity bias
      3) fallback to Nominatim
      4) fallback to district centroid (district,state)
      5) store result (lat,lon or None) to cache and return
    """
    if cache is None:
        cache = {}

    if not raw_address or not isinstance(raw_address, str):
        return None, None

    key = raw_address.strip()
    # quick lookup by exact raw address key
    if key in cache:
        val = cache[key]
        if val is None:
            return None, None
        return val.get("lat"), val.get("lon")

    # Clean the address for querying
    address = clean_address(raw_address)
    if not address:
        cache[key] = None
        return None, None

    # 1) Geoapify with proximity bias
    lat, lon = geocode_geoapify(address, user_lat, user_lon)
    if lat is not None:
        cache[key] = {"lat": lat, "lon": lon, "source": "geoapify", "queried": address, "ts": datetime.utcnow().isoformat()}
        return lat, lon

    # 2) Nominatim fallback
    lat, lon = geocode_nominatim(address)
    if lat is not None:
        cache[key] = {"lat": lat, "lon": lon, "source": "nominatim", "queried": address, "ts": datetime.utcnow().isoformat()}
        return lat, lon

    # 3) district centroid fallback
    lat, lon = geocode_district_centroid(district, state, user_lat, user_lon)
    if lat is not None:
        cache[key] = {"lat": lat, "lon": lon, "source": "district_centroid", "queried": f"{district},{state}", "ts": datetime.utcnow().isoformat()}
        return lat, lon

    # 4) record failure
    cache[key] = None
    return None, None

# ---------- main flow ----------

def main():
    # load or refresh aggregated price data (you already have caching in hargapedia_cli)
    print("1) Loading PriceCatcher data (cached or refreshed on refresh days)...")
    df = download_and_aggregate()

    expected_cols = {
        "date","premise_code","item_code","price","premise",
        "address","premise_type","state","district","item",
        "unit","item_group","item_category"
    }
    missing = expected_cols - set(df.columns)
    if missing:
        print("Warning: dataset missing expected columns:", missing)

    # get user location
    try:
        user_lat, user_lon = get_user_location()
    except Exception as e:
        print("Failed to get user location:", e)
        return

    print(f"\nYour coordinates: {user_lat:.6f}, {user_lon:.6f}")
    # optional reverse-geocode to get state/district
    try:
        addr_info = None
        from geopy.geocoders import Nominatim as GeoNominatim
        g = GeoNominatim(user_agent="recommender_reverse")
        loc_rev = g.reverse((user_lat, user_lon), exactly_one=True, timeout=8)
        if loc_rev:
            raw_addr = loc_rev.raw.get("address", {})
            state = raw_addr.get("state") or raw_addr.get("state_district")
            district = raw_addr.get("county") or raw_addr.get("city_district") or raw_addr.get("suburb")
            pretty = ", ".join([raw_addr.get(k) for k in ("road","suburb","county","state","postcode","country") if raw_addr.get(k)])
            addr_info = {"pretty": pretty, "state": state, "district": district}
    except Exception:
        addr_info = {"pretty": None, "state": None, "district": None}

    print("Reverse-geocoded address:", addr_info.get("pretty") if addr_info else "(not available)")
    print("Detected state:", addr_info.get("state") if addr_info else None)
    print("Detected district:", addr_info.get("district") if addr_info else None)
    print("\n")
    # input("\nPress Enter to continue and search within this area...")

    # ---------- area filtering ----------
    df_area = df.copy()
    if addr_info and addr_info.get("state"):
        df_area = df_area[df_area["state"].fillna("").str.lower().str.contains(str(addr_info["state"]).lower())]
    if not df_area.empty and addr_info and addr_info.get("district"):
        df_d = df_area[df_area["district"].fillna("").str.lower().str.contains(str(addr_info["district"]).lower())]
        if not df_d.empty:
            df_area = df_d
    if df_area.empty:
        df_area = df.copy()

    # ---------- product ----------
    # Item list
    items = df_area["item"].dropna().unique().tolist()
    product_q = input("\nEnter product name or item_code: ").strip()
    while not product_q:
        print("No input; exiting.")
        return

    if product_q.isdigit():
        df_prod = df_area[df_area["item_code"].astype(str) == product_q]
    else:
        matched_items = match_items(product_q, items)
        if not matched_items:
            print("No matching product found.")
            return
        best_match = matched_items[0][0]
        df_prod = df_area[df_area["item"].fillna("").str.lower().str.contains(best_match.lower())]

    if df_prod.empty:
        print("No matching product found.")
        return

    # ensure price numeric safely
    df_prod.loc[:, "price"] = pd.to_numeric(df_prod["price"], errors="coerce")

    grouped = (
        df_prod
        .groupby(["premise_code","premise","address","state","district"], as_index=False)
        .agg(min_price=("price","min"), last_date=("date","max"))
        .dropna(subset=["min_price"])
        .sort_values("min_price")
        .reset_index(drop=True)
    )

    top = grouped.head(20).copy()  # compute for top 20 then sort by distance later

    # ---------- geocoding with cache and bias ----------
    cache = load_geocache()
    geolocator = Nominatim(user_agent="recommender_geocoder")

    distances = []
    lats = []
    lons = []
    sources = []

    print("\nGeocoding top candidates (using Geoapify with proximity bias -> fallback Nominatim -> district centroid).")

    # Use a lock to protect concurrent access to the shared cache
    cache_lock = Lock()

    # Worker: mirrors the original per-row geocoding logic but is safe to run in threads
    def geocode_worker(args):
        idx, raw_addr, district, state = args
        key_preview = (raw_addr or "")[:80].replace("\n", " ")
        lat_p = lon_p = None
        src = None

        key = raw_addr.strip() if raw_addr and isinstance(raw_addr, str) else ""

        # check cache under lock
        if key:
            with cache_lock:
                entry = cache.get(key) if key in cache else None
            if entry is not None:
                if entry:
                    lat_p, lon_p = entry.get("lat"), entry.get("lon")
                    src = entry.get("source", "cache")
                else:
                    lat_p = lon_p = None
                    src = None
                # compute distance and return
                d = haversine_km(user_lat, user_lon, lat_p, lon_p) if lat_p is not None and lon_p is not None else None
                print(f"  [{idx+1}/{len(top)}] {key_preview} -> {src or 'none'} -> {lat_p},{lon_p} -> {d if d is not None else 'N/A'}")
                return idx, d, lat_p, lon_p, src

        # not in cache or no key
        if not raw_addr or not isinstance(raw_addr, str) or not raw_addr.strip():
            lat_p, lon_p = geocode_district_centroid(district, state, user_lat, user_lon)
            src = "district_centroid" if lat_p else None
            cleaned = None
        else:
            cleaned = clean_address(raw_addr)
            lat_p, lon_p = geocode_geoapify(cleaned, user_lat, user_lon)
            if lat_p is not None:
                src = "geoapify"
            else:
                lat_p, lon_p = geocode_nominatim(cleaned)
                if lat_p is not None:
                    src = "nominatim"
                else:
                    lat_p, lon_p = geocode_district_centroid(district, state, user_lat, user_lon)
                    src = "district_centroid" if lat_p else None

        # store result into cache under lock
        if key:
            with cache_lock:
                cache[key] = {"lat": lat_p, "lon": lon_p, "source": src, "queried": cleaned, "ts": datetime.utcnow().isoformat()} if lat_p is not None else None

        # polite pause to avoid hitting rate limits too aggressively
        time.sleep(0.1)

        d = haversine_km(user_lat, user_lon, lat_p, lon_p) if lat_p is not None and lon_p is not None else None
        print(f"  [{idx+1}/{len(top)}] {key_preview} -> {src or 'none'} -> {lat_p},{lon_p} -> {d if d is not None else 'N/A'}")
        return idx, d, lat_p, lon_p, src

    # prepare args preserving top order
    args_list = [ (i, row.get("address"), row.get("district"), row.get("state")) for i, row in top.iterrows() ]

    # choose a conservative number of workers to avoid rate-limits
    max_workers = min(6, max(1, len(args_list)))
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        for idx, d, lat_p, lon_p, src in ex.map(geocode_worker, args_list):
            distances.append(d)
            lats.append(lat_p)
            lons.append(lon_p)
            sources.append(src)

    # save cache after the loop
    save_geocache(cache)

    top["distance_km"] = distances
    top["lat"] = lats
    top["lon"] = lons
    top["geocode_source"] = sources

    # final sort: distance (ascending), then price
    top = top.sort_values(by=["distance_km", "min_price"], na_position="last").reset_index(drop=True)

    # select columns for display
    display_cols = ["premise","min_price","distance_km","lat","lon","geocode_source","address","state","district","last_date"]

    print("\nTop cheapest results (sorted by distance, then price):\n")
    print(top[display_cols].to_string(index=False))

    print("\nNotes:")
    print("- Distance is straight-line (displacement), not road distance.")
    print("- Geoapify used first with proximity bias; Nominatim and district centroid used as fallback.")
    print("- geocache.json stores address -> coords to speed up future runs.")

if __name__ == "__main__":
    main()
