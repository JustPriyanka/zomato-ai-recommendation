"""
FastAPI backend for the Zomato AI Restaurant Recommender.

Run locally:
    uvicorn api:app --reload --port 8000

Deploy on Railway:
    Set env vars: GROQ_API_KEY, ALLOWED_ORIGINS (comma-separated, e.g. https://your-app.vercel.app)
"""

import os
import sys
import threading
import numpy as np
import pandas as pd
from pathlib import Path
from contextlib import asynccontextmanager
from collections import Counter
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

sys.path.append(str(Path(__file__).resolve().parent))

from models.schemas import UserPreferences, Restaurant, Recommendation, LLMResponse
from data.loader import load_and_clean_data
from engine.filter import filter_restaurants
from engine.recommender import get_recommendations

# ---------------------------------------------------------------------------
# App state — dataset loaded in a background thread so Railway's health check
# passes immediately instead of timing out during the 3-5 min download.
# ---------------------------------------------------------------------------
_df: Optional[pd.DataFrame] = None
_loading: bool = False
_load_error: Optional[str] = None


def _load_dataset_background():
    """Download/cache the dataset in a background thread."""
    global _df, _loading, _load_error
    try:
        _df = load_and_clean_data()
    except Exception as exc:
        _load_error = str(exc)
    finally:
        _loading = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _loading
    _loading = True
    thread = threading.Thread(target=_load_dataset_background, daemon=True)
    thread.start()
    yield


app = FastAPI(title="Zomato AI API", lifespan=lifespan)

# ---------------------------------------------------------------------------
# CORS — allow local dev + any origins listed in ALLOWED_ORIGINS env var
# ---------------------------------------------------------------------------
_raw_origins = os.getenv("ALLOWED_ORIGINS", "")
_extra_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
_allowed_origins = [
    "http://localhost:5173",  # Vite dev server
    "http://localhost:3000",
] + _extra_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Shared guard — raises 503 with a user-friendly message if data isn't ready
# ---------------------------------------------------------------------------
def _require_df() -> pd.DataFrame:
    if _loading:
        raise HTTPException(
            status_code=503,
            detail="Dataset is still loading — please wait a moment and try again.",
        )
    if _load_error:
        raise HTTPException(
            status_code=500,
            detail=f"Dataset failed to load: {_load_error}",
        )
    if _df is None:
        raise HTTPException(status_code=503, detail="Dataset not available.")
    return _df


# ---------------------------------------------------------------------------
# Response schema
# ---------------------------------------------------------------------------
class RecommendResponse(BaseModel):
    mode: str          # "llm" | "degraded" | "no_results"
    summary: str
    recommendations: list


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health():
    """
    Returns the current dataset load status.
    - status: "loading" while the background thread is running
    - status: "error"   if the download failed
    - status: "ok"      once data is ready
    Railway uses this endpoint to gauge service health.
    """
    if _loading:
        return {"status": "loading", "restaurants": 0}
    if _load_error:
        return {"status": "error", "error": _load_error, "restaurants": 0}
    return {"status": "ok", "restaurants": len(_df) if _df is not None else 0}


@app.get("/api/locations")
def locations():
    """Return sorted list of unique locations present in the dataset."""
    df = _require_df()
    locs = sorted(df["location"].dropna().unique().tolist())
    return {"locations": locs}


@app.get("/api/cuisines")
def cuisines(limit: int = 15, tier: str = "popular"):
    """
    Return cuisines from the dataset.
    tier=popular   → top `limit` by restaurant count (default)
    tier=specialty → curated niche/exotic list, filtered to those with ≥ 20 restaurants
    """
    df = _require_df()

    counter: Counter = Counter()
    for val in df["cuisines"]:
        if isinstance(val, (list, np.ndarray)):
            for c in val:
                if c and str(c).strip():
                    counter[str(c).strip()] += 1

    if tier == "specialty":
        SPECIALTY_POOL = [
            "Momos", "Healthy Food", "Thai", "Mughlai", "Arabian",
            "Korean", "Mexican", "BBQ", "Tibetan", "Mediterranean",
            "Japanese", "Vietnamese", "Lebanese", "Seafood", "Kebab",
        ]
        result = [c for c in SPECIALTY_POOL if counter.get(c, 0) >= 20]
        return {"cuisines": result}

    top = [cuisine for cuisine, _ in counter.most_common(limit)]
    return {"cuisines": top}


@app.post("/api/recommend", response_model=RecommendResponse)
def recommend(prefs: UserPreferences):
    df = _require_df()

    candidates = filter_restaurants(df, prefs)

    if candidates.empty:
        return RecommendResponse(mode="no_results", summary="", recommendations=[])

    llm_response: Optional[LLMResponse] = get_recommendations(candidates, prefs)

    if llm_response:
        return RecommendResponse(
            mode="llm",
            summary=llm_response.summary,
            recommendations=[r.model_dump() for r in llm_response.recommendations],
        )

    # Degraded fallback — top-5 by rating, no AI explanations
    top5 = candidates.head(5).reset_index(drop=True)
    fallback: list = []
    for i, (_, row) in enumerate(top5.iterrows(), start=1):
        row_dict = row.to_dict()
        for k, v in row_dict.items():
            if isinstance(v, (list, np.ndarray)):
                row_dict[k] = list(v)
            elif pd.isna(v):
                row_dict[k] = None

        restaurant = Restaurant(**row_dict)
        fallback.append(
            Recommendation(
                rank=i,
                restaurant=restaurant,
                explanation="",
                highlights=[],
            ).model_dump()
        )

    return RecommendResponse(mode="degraded", summary="", recommendations=fallback)
