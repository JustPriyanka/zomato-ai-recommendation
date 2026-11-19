import os
import re
import pandas as pd
from datasets import load_dataset
from rich.console import Console
from pathlib import Path
import sys

# Ensure parent directory is in sys.path to allow imports when run as script
sys.path.append(str(Path(__file__).resolve().parent.parent))
from config import CACHE_DIR

console = Console()

def extract_rating(rate_str) -> float:
    if pd.isna(rate_str):
        return None
    rate_str = str(rate_str).strip()
    if rate_str in ["NEW", "-", "nan"]:
        return None
    match = re.search(r"(\d+\.\d+)", rate_str)
    if match:
        return float(match.group(1))
    return None

def parse_list(item_str):
    if pd.isna(item_str):
        return []
    # Split by comma and strip whitespace
    return [i.strip() for i in str(item_str).split(",") if i.strip()]

def clean_cost(cost_str):
    if pd.isna(cost_str):
        return None
    cost_str = str(cost_str).replace(",", "").strip()
    try:
        return int(cost_str)
    except ValueError:
        return None

def clean_data(df: pd.DataFrame) -> pd.DataFrame:
    """Apply cleaning logic to the raw dataframe according to architecture specs."""
    console.print("[yellow]Cleaning data...[/yellow]")
    
    cleaned = pd.DataFrame()
    
    # 1. name
    cleaned["name"] = df["name"].astype(str).str.strip()
    
    # 2. url
    cleaned["url"] = df["url"]
    
    # 3. address
    cleaned["address"] = df["address"].astype(str).str.strip()
    
    # 4. online_order
    cleaned["online_order"] = df["online_order"].apply(lambda x: True if str(x).strip().lower() == "yes" else False)
    
    # 5. book_table
    cleaned["book_table"] = df["book_table"].apply(lambda x: True if str(x).strip().lower() == "yes" else False)
    
    # 6. rating (rate)
    cleaned["rating"] = df["rate"].apply(extract_rating)
    
    # 7. votes
    cleaned["votes"] = pd.to_numeric(df["votes"], errors="coerce").fillna(0).astype(int)
    
    # 8. phone
    cleaned["phone"] = df["phone"]
    
    # 9. location
    cleaned["location"] = df["location"].astype(str).str.strip()
    
    # 10. restaurant_type (rest_type)
    cleaned["restaurant_type"] = df["rest_type"].astype(str).str.strip()
    
    # 11. popular_dishes (dish_liked)
    cleaned["popular_dishes"] = df["dish_liked"].apply(parse_list)
    
    # 12. cuisines
    cleaned["cuisines"] = df["cuisines"].apply(parse_list)
    
    # 13. cost_for_two (approx_cost(for two people))
    if "approx_cost(for two people)" in df.columns:
        cleaned["cost_for_two"] = df["approx_cost(for two people)"].apply(clean_cost)
    else:
        cleaned["cost_for_two"] = None
        
    # 14. reviews (reviews_list)
    cleaned["reviews"] = df["reviews_list"]
    
    # 15. menu_items (menu_item)
    cleaned["menu_items"] = df["menu_item"]
    
    # 16. listing_type (listed_in(type))
    if "listed_in(type)" in df.columns:
        cleaned["listing_type"] = df["listed_in(type)"].astype(str).str.strip()
    else:
        cleaned["listing_type"] = None
        
    # 17. city (listed_in(city))
    if "listed_in(city)" in df.columns:
        cleaned["city"] = df["listed_in(city)"].astype(str).str.strip()
    else:
        cleaned["city"] = None

    # The raw dataset repeats each restaurant once per (listed_in(city), listed_in(type)) page it was
    # scraped under, so `city` is a scrape-category artifact rather than a reliable location signal
    # (e.g. the same restaurant on "Hosur Road" can appear tagged under city="BTM", "HSR", "Jayanagar", etc).
    # Collapse duplicates of the same physical restaurant (name, address) down to one row, keeping the
    # version with the most votes as the most complete/reliable snapshot.
    before = len(cleaned)
    cleaned = (
        cleaned.sort_values("votes", ascending=False)
        .drop_duplicates(subset=["name", "address"], keep="first")
        .reset_index(drop=True)
    )
    console.print(f"[yellow]Deduplicated {before - len(cleaned)} repeated listing rows ({before} -> {len(cleaned)}).[/yellow]")

    console.print("[green]Data cleaned successfully![/green]")
    return cleaned

def load_and_clean_data(refresh: bool = False) -> pd.DataFrame:
    """
    Loads data from local cache if it exists. 
    Otherwise, downloads from HuggingFace, cleans it, and caches it.
    """
    cache_path = CACHE_DIR / "restaurants.parquet"
    
    if cache_path.exists() and not refresh:
        console.print(f"[green]Loading cached dataset from {cache_path}...[/green]")
        return pd.read_parquet(cache_path)
    
    console.print("[cyan]Downloading dataset from Hugging Face (ManikaSaini/zomato-restaurant-recommendation)...[/cyan]")
    dataset = load_dataset("ManikaSaini/zomato-restaurant-recommendation", split="train")
    df = dataset.to_pandas()
    
    cleaned_df = clean_data(df)
    
    console.print(f"[yellow]Saving cleaned dataset to cache at {cache_path}...[/yellow]")
    cleaned_df.to_parquet(cache_path, index=False)
    
    return cleaned_df

if __name__ == "__main__":
    df = load_and_clean_data()
    print(df.head())
    print(f"Total rows: {len(df)}")
