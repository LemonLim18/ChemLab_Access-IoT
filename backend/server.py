# TO START THE SERVER: 
# uvicorn server:app --host 0.0.0.0 --port 8000 --reload
# backend_app.py
from fastapi import FastAPI, HTTPException
from dotenv import load_dotenv
import os

# Load environment variables from .env file
load_dotenv()
from pydantic import BaseModel
from typing import Optional, List, Any, Dict
import recommender  # your original file; we do not modify it
import geminiRecipe
import pandas as pd
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
import time
from datetime import datetime
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Price Recommender API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://192.168.1.117:5173"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Class is something similar to the interface in TypeScript
class RecommendRequest(BaseModel):
    product: str
    user_lat: Optional[float] = None
    user_lon: Optional[float] = None
    max_results: Optional[int] = 20
    # optional area override (if you want to force a state/district filter)
    state_hint: Optional[str] = None
    district_hint: Optional[str] = None

class RecommendRow(BaseModel):
    premise: Optional[str]
    min_price: Optional[float]
    distance_km: Optional[float]
    lat: Optional[float]
    lon: Optional[float]
    geocode_source: Optional[str]
    address: Optional[str]
    state: Optional[str]
    district: Optional[str]
    last_date: Optional[Any]

class RecipeRequest(BaseModel):
    items: List[Dict[str, Any]]
    user_prompt: Optional[str] = ""

class RecipeDetailsRequest(BaseModel):
    recipe_name: str
    items: List[Dict[str, Any]]

class SnapshotRequest(BaseModel):
    image_base64: str

@app.post("/recommend", response_model=List[RecommendRow])
def recommend(req: RecommendRequest):
    """
    Returns top places selling `product` near user's location (or globally if location not available).
    This reuses the logic in recommender.py (download_and_aggregate, geocoders, cache).
    """
    # 1) Load price data using your original function (no changes to recommender.py)
    try:
        df = recommender.download_and_aggregate()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load price data: {e}")

    expected_cols = {
        "date","premise_code","item_code","price","premise",
        "address","premise_type","state","district","item",
        "unit","item_group","item_category"
    }
    missing = expected_cols - set(df.columns)
    if missing:
        # not fatal; warn via HTTP 400? we just continue but include in detail
        # keep behaviour similar to original script (it printed a warning)
        pass

    # 2) Determine user location if not provided
    user_lat = req.user_lat
    user_lon = req.user_lon
    if user_lat is None or user_lon is None:
        # try to call get_user_location from recommender (it was imported there)
        try:
            user_lat, user_lon = recommender.get_user_location()
        except Exception:
            # if that fails, set as None to continue (the geocoders handle that)
            user_lat = user_lon = None

    # 3) Reverse geocode to get state/district hints (try Nominatim as in your original)
    addr_info = {"pretty": None, "state": None, "district": None}
    if user_lat is not None and user_lon is not None:
        try:
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

    # override with hints from request if provided
    if req.state_hint:
        addr_info["state"] = req.state_hint
    if req.district_hint:
        addr_info["district"] = req.district_hint

    # 4) Area filtering
    df_area = df.copy()
    if addr_info and addr_info.get("state"):
        df_area = df_area[df_area["state"].fillna("").str.lower().str.contains(str(addr_info["state"]).lower(), na=False)]
    if not df_area.empty and addr_info and addr_info.get("district"):
        df_d = df_area[df_area["district"].fillna("").str.lower().str.contains(str(addr_info["district"]).lower(), na=False)]
        if not df_d.empty:
            df_area = df_d
    if df_area.empty:
        df_area = df.copy()

    # 5) Product matching (use your original matcher)
    product_q = req.product.strip()
    if not product_q:
        raise HTTPException(status_code=400, detail="Empty product provided")

    if product_q.isdigit():
        df_prod = df_area[df_area["item_code"].astype(str) == product_q]
    else:
        items = df_area["item"].dropna().unique().tolist()
        matched_items = recommender.match_items(product_q, items)
        if not matched_items:
            raise HTTPException(status_code=404, detail="No matching product found")
        best_match = matched_items[0][0]
        df_prod = df_area[df_area["item"].fillna("").str.lower().str.contains(best_match.lower())]

    if df_prod.empty:
        raise HTTPException(status_code=404, detail="No matching product rows found")

    # ensure numeric price (same as original)
    df_prod.loc[:, "price"] = pd.to_numeric(df_prod["price"], errors="coerce")

    grouped = (
        df_prod
        .groupby(["premise_code","premise","address","state","district"], as_index=False)
        .agg(min_price=("price","min"), last_date=("date","max"))
        .dropna(subset=["min_price"])
        .sort_values("min_price")
        .reset_index(drop=True)
    )

    top = grouped.head(max(50, req.max_results)).copy()  # compute more then we will sort by distance and limit later

    # 6) Geocoding with cache + concurrency
    cache = recommender.load_geocache()
    cache_lock = Lock()

    distances = []
    lats = []
    lons = []
    sources = []

    # worker uses the same geocoding strategy as the original recommender.main
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
                d = recommender.haversine_km(user_lat, user_lon, lat_p, lon_p) if (user_lat is not None and lat_p is not None and lon_p is not None) else None
                return idx, d, lat_p, lon_p, src

        # not in cache or no key
        if not raw_addr or not isinstance(raw_addr, str) or not raw_addr.strip():
            lat_p, lon_p = recommender.geocode_district_centroid(district, state, user_lat, user_lon)
            src = "district_centroid" if lat_p else None
            cleaned = None
        else:
            cleaned = recommender.clean_address(raw_addr)
            lat_p, lon_p = recommender.geocode_geoapify(cleaned, user_lat, user_lon)
            if lat_p is not None:
                src = "geoapify"
            else:
                lat_p, lon_p = recommender.geocode_nominatim(cleaned)
                if lat_p is not None:
                    src = "nominatim"
                else:
                    lat_p, lon_p = recommender.geocode_district_centroid(district, state, user_lat, user_lon)
                    src = "district_centroid" if lat_p else None

        # store result into cache under lock
        if key:
            with cache_lock:
                cache[key] = {"lat": lat_p, "lon": lon_p, "source": src, "queried": cleaned, "ts": datetime.utcnow().isoformat()} if lat_p is not None else None

        # small sleep (same as original)
        time.sleep(0.1)

        d = recommender.haversine_km(user_lat, user_lon, lat_p, lon_p) if (user_lat is not None and lat_p is not None and lon_p is not None) else None
        return idx, d, lat_p, lon_p, src

    args_list = [ (i, row.get("address"), row.get("district"), row.get("state")) for i, row in top.iterrows() ]
    max_workers = min(6, max(1, len(args_list)))
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        for idx, d, lat_p, lon_p, src in ex.map(geocode_worker, args_list):
            distances.append(d)
            lats.append(lat_p)
            lons.append(lon_p)
            sources.append(src)

    # persist cache (same as original)
    recommender.save_geocache(cache)

    top["distance_km"] = distances
    top["lat"] = lats
    top["lon"] = lons
    top["geocode_source"] = sources

    # final sort: distance (ascending), then price (like the script)
    top = top.sort_values(by=["distance_km", "min_price"], na_position="last").reset_index(drop=True)

    # limit results
    top = top.head(req.max_results)

    # select columns for response
    display_cols = ["premise","min_price","distance_km","lat","lon","geocode_source","address","state","district","last_date"]

    # convert last_date to string where necessary
    top = top[display_cols].copy()
    top["last_date"] = top["last_date"].astype(str)

    # Convert to list of dicts for JSON response
    result = top.to_dict(orient="records")
    return result

@app.post("/generate-recipe")
def generate_recipe(req: RecipeRequest):
    return geminiRecipe.generate_recipes(req.items, req.user_prompt)

@app.post("/recipe-details")
def recipe_details(req: RecipeDetailsRequest):
    return geminiRecipe.get_recipe_details(req.recipe_name, req.items)

@app.post("/analyze-snapshot")
def analyze_snapshot(req: SnapshotRequest):
    return geminiRecipe.analyze_snapshot(req.image_base64)