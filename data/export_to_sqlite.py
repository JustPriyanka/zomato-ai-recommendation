"""
Exports the cleaned dataset cache (data/cache/restaurants.parquet) to a directly
queryable SQLite database at data/restaurants.db, for manual inspection/verification
of the data (parquet is a binary format and isn't human-readable).

This is a debugging convenience only - the app itself never reads restaurants.db,
only restaurants.parquet (see data/loader.py). Regenerate after any change to the
cache (e.g. after running `python app.py --refresh`):

    python data/export_to_sqlite.py
"""
import sqlite3
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.append(str(Path(__file__).resolve().parent.parent))
from config import CACHE_DIR

PARQUET_PATH = CACHE_DIR / "restaurants.parquet"
DB_PATH = Path(__file__).resolve().parent / "restaurants.db"

# Excluded: raw scraped review text, unused by the app and ~90MB across the full dataset
EXCLUDED_COLUMNS = ["reviews"]
LIST_COLUMNS = ["cuisines", "popular_dishes"]


def _list_to_str(value):
    if isinstance(value, (list, np.ndarray)) and len(value) > 0:
        return ", ".join(str(v) for v in value)
    return None


def export():
    if not PARQUET_PATH.exists():
        raise FileNotFoundError(f"{PARQUET_PATH} not found - run `python app.py` at least once first.")

    df = pd.read_parquet(PARQUET_PATH)
    export_df = df.drop(columns=EXCLUDED_COLUMNS, errors="ignore")

    for col in LIST_COLUMNS:
        if col in export_df.columns:
            export_df[col] = export_df[col].apply(_list_to_str)

    conn = sqlite3.connect(DB_PATH)
    try:
        export_df.to_sql("restaurants", conn, index=False, if_exists="replace")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_location ON restaurants(location)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_name ON restaurants(name)")
        conn.commit()
    finally:
        conn.close()

    print(f"Exported {len(export_df)} rows to {DB_PATH}")


if __name__ == "__main__":
    export()
