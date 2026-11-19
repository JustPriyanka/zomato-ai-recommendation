import pandas as pd
from typing import Optional
import sys
from pathlib import Path

# Ensure parent directory is in sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))
from models.schemas import UserPreferences
from config import MAX_CANDIDATES

# Below this many candidates, widen budget/rating rather than accepting a thin result set
# (architecture.md §4.3: "Too few results (< 5) -> Widen budget range or lower rating threshold")
MIN_CANDIDATES_THRESHOLD = 5

def _apply_location_filter(df: pd.DataFrame, location: str) -> pd.DataFrame:
    # `city` (listed_in(city)) is a scrape-category artifact, not a reliable location signal -
    # the same restaurant can appear tagged under several unrelated `city` values. Match on
    # `location` only, since it reflects the restaurant's actual address-derived neighborhood.
    loc_lower = location.lower()
    return df[df["location"].str.lower().str.contains(loc_lower, na=False)]

def _apply_cuisine_filter(df: pd.DataFrame, cuisines: list[str]) -> pd.DataFrame:
    cuisines_lower = [c.lower() for c in cuisines]
    def has_overlap(rest_cuisines):
        if not isinstance(rest_cuisines, list):
            return False
        rest_lower = [c.lower() for c in rest_cuisines]
        return any(c in rest_lower for c in cuisines_lower)
    return df[df["cuisines"].apply(has_overlap)]

def _apply_budget_filter(df: pd.DataFrame, budget: str) -> pd.DataFrame:
    if budget == "low":
        return df[df["cost_for_two"] <= 300]
    elif budget == "medium":
        return df[(df["cost_for_two"] > 300) & (df["cost_for_two"] <= 700)]
    elif budget == "high":
        return df[df["cost_for_two"] > 700]
    return df

def _apply_rating_filter(df: pd.DataFrame, min_rating: float) -> pd.DataFrame:
    return df[df["rating"] >= min_rating]

def _apply_optional_filters(df: pd.DataFrame, prefs: UserPreferences) -> pd.DataFrame:
    if prefs.online_order is not None:
        df = df[df["online_order"] == prefs.online_order]
    if prefs.book_table is not None:
        df = df[df["book_table"] == prefs.book_table]
    if prefs.restaurant_type:
        rest_type_lower = prefs.restaurant_type.lower()
        df = df[df["restaurant_type"].str.lower().str.contains(rest_type_lower, na=False)]
    return df

def filter_restaurants(df: pd.DataFrame, prefs: UserPreferences) -> pd.DataFrame:
    """
    Applies structured filters sequentially.
    If no restaurants match, it relaxes filters progressively:
    rating -> budget -> cuisine -> location.
    """
    if df.empty:
        return df
        
    filtered = df.copy()
    
    # Track the state to relax filters if needed
    state = filtered.copy()
    
    # 1. Location
    if prefs.location:
        filtered = _apply_location_filter(filtered, prefs.location)
        if filtered.empty:
            return filter_restaurants(df, UserPreferences(**{**prefs.model_dump(), "location": None}))
        state = filtered.copy()
        
    # 2. Cuisine
    if prefs.cuisines:
        filtered = _apply_cuisine_filter(filtered, prefs.cuisines)
        if filtered.empty:
            # Relax cuisine filter
            return filter_restaurants(df, UserPreferences(**{**prefs.model_dump(), "cuisines": None}))
        state = filtered.copy()
        
    # 3. Budget
    if prefs.budget:
        filtered = _apply_budget_filter(filtered, prefs.budget)
        if filtered.empty:
            # Relax budget filter
            return filter_restaurants(df, UserPreferences(**{**prefs.model_dump(), "budget": None}))
        if len(filtered) < MIN_CANDIDATES_THRESHOLD:
            # Too few results: widen by dropping the budget constraint, if that actually helps
            widened = filter_restaurants(df, UserPreferences(**{**prefs.model_dump(), "budget": None}))
            if len(widened) > len(filtered):
                return widened
        state = filtered.copy()

    # 4. Rating
    if prefs.min_rating:
        filtered = _apply_rating_filter(filtered, prefs.min_rating)
        if filtered.empty:
            # Relax rating filter
            return filter_restaurants(df, UserPreferences(**{**prefs.model_dump(), "min_rating": None}))
        if len(filtered) < MIN_CANDIDATES_THRESHOLD:
            # Too few results: lower the rating threshold, if that actually helps
            widened = filter_restaurants(df, UserPreferences(**{**prefs.model_dump(), "min_rating": None}))
            if len(widened) > len(filtered):
                return widened
        state = filtered.copy()
        
    # 5. Optional
    filtered = _apply_optional_filters(filtered, prefs)
    if filtered.empty:
        # Revert optional filters
        filtered = state
        
    # 6. Sort and Limit
    # Fill NaN ratings and votes with 0 before sorting
    filtered = filtered.copy()
    filtered["sort_rating"] = filtered["rating"].fillna(0)
    filtered["sort_votes"] = filtered["votes"].fillna(0)
    
    filtered = filtered.sort_values(by=["sort_rating", "sort_votes"], ascending=[False, False])
    
    # Drop temp columns
    filtered = filtered.drop(columns=["sort_rating", "sort_votes"])
    
    return filtered.head(MAX_CANDIDATES)

if __name__ == "__main__":
    from data.loader import load_and_clean_data
    df = load_and_clean_data()
    prefs = UserPreferences(
        location="Bangalore",
        cuisines=["Italian", "Chinese"],
        budget="medium",
        min_rating=4.0
    )
    result = filter_restaurants(df, prefs)
    print(f"Found {len(result)} candidates")
    print(result[["name", "location", "cost_for_two", "rating", "cuisines"]].head())
