# hargapedia_cli.py
import pandas as pd
from datetime import datetime
import requests
import os

def download_and_aggregate():
    save_dir = "csv_files"
    os.makedirs(save_dir, exist_ok=True)

    # refresh only on these days
    refresh_days = {1, 14, 28}

    now = datetime.now()
    year = now.year
    month_str = f"{now.month:02d}"
    today_day = now.day

    aggregated_file = os.path.join(
        save_dir,
        f"pricecatcher_aggregated_{year}_{month_str}.csv"
    )

    # ---- USE CACHE IF ALLOWED ----
    if os.path.exists(aggregated_file) and today_day not in refresh_days:
        print(f"[✓] Using cached aggregated data: {aggregated_file}")
        return pd.read_csv(aggregated_file)

    print("[↻] Refreshing PriceCatcher data...")

    # ---- URLs ----
    lookup_premise_url = "https://storage.data.gov.my/pricecatcher/lookup_premise.csv"
    item_lookup_url = "https://storage.data.gov.my/pricecatcher/lookup_item.csv"
    transaction_record_url = (
        f"https://storage.data.gov.my/pricecatcher/pricecatcher_{year}-{month_str}.csv"
    )

    lookup_premise_file = os.path.join(save_dir, "lookup_premise.csv")
    item_lookup_file = os.path.join(save_dir, "lookup_item.csv")
    transaction_file = os.path.join(save_dir, f"pricecatcher_{year}_{month_str}.csv")

    def download_csv(url, save_path):
        r = requests.get(url, timeout=30)
        r.raise_for_status()
        with open(save_path, "wb") as f:
            f.write(r.content)

    # ---- DOWNLOAD ----
    print("[↓] Downloading Lookup Premise CSV...")
    download_csv(lookup_premise_url, lookup_premise_file)
    print("[↓] Downloading Lookup Item CSV...")
    download_csv(item_lookup_url, item_lookup_file)
    print("[↓] Downloading Transaction Record CSV...")
    download_csv(transaction_record_url, transaction_file)

    # ---- LOAD ----
    df_premise = pd.read_csv(lookup_premise_file)
    df_item = pd.read_csv(item_lookup_file)
    df_price = pd.read_csv(transaction_file)

    # ---- MERGE ----
    df_merged = df_price.merge(df_premise, on="premise_code", how="left")
    df_merged = df_merged.merge(df_item, on="item_code", how="left")

    # ---- SAVE CACHE ----
    try:
        df_merged.to_csv(aggregated_file, index=False)
        print(f"[+] Aggregated CSV saved to {aggregated_file}")
    except PermissionError:
        print("[!] Could not write cache (file open elsewhere). Using in-memory data.")

    return df_merged

if __name__ == "__main__":
    download_and_aggregate()
