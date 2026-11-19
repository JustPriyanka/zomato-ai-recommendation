# Zomato AI-Powered Restaurant Recommendation System

A CLI app that recommends restaurants by combining structured filtering (location, cuisine, budget, rating) with an LLM (via [Groq](https://groq.com/), free tier) for ranked, explainable recommendations. Dataset: [ManikaSaini/zomato-restaurant-recommendation](https://huggingface.co/datasets/ManikaSaini/zomato-restaurant-recommendation) (Hugging Face).

See `Docs/architecture.md` for the full system design and `Docs/implementation-plan.md` for build status.

## Setup

1. Create and activate a virtual environment:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` and set `GROQ_API_KEY` to your Groq API key (free — get one at [console.groq.com](https://console.groq.com/keys)).

## Run

```bash
python app.py
```

On first run, the app downloads and cleans the dataset from Hugging Face, then caches it locally at `data/cache/restaurants.parquet` for fast subsequent runs. You'll be prompted for location, cuisine, budget, minimum rating, and any additional notes, then shown ranked recommendations with explanations.

## Configuration

Set via `.env` (see `.env.example` for defaults):

| Variable | Default | Description |
|---|---|---|
| `GROQ_API_KEY` | (required) | API key for Groq |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Model used for recommendations |
| `MAX_CANDIDATES` | `20` | Max restaurants passed to the LLM per request |
| `TOP_K` | `5` | Number of recommendations returned |
| `CACHE_DIR` | `data/cache` | Directory for the cached dataset |
| `LOG_LEVEL` | `INFO` | Logging verbosity |

## Project Structure

```
├── app.py                    # CLI entry point / orchestration
├── config.py                 # Environment-based configuration
├── data/
│   ├── loader.py              # Dataset download, cleaning, caching
│   └── export_to_sqlite.py    # Debug helper: exports the cache to a queryable SQLite DB
├── engine/
│   ├── filter.py               # Structured candidate filtering
│   └── recommender.py          # LLM prompt construction and response parsing
├── models/
│   └── schemas.py              # Pydantic data models
└── Docs/                      # Architecture, plan, edge cases, eval docs
```

## Inspecting the Data

`data/cache/restaurants.parquet` (the app's actual data source) is a binary format and isn't human-readable directly. For manual inspection/verification, generate a plain SQLite database instead:

```bash
python data/export_to_sqlite.py
```

This writes `data/restaurants.db`, queryable immediately with no import step:

```bash
sqlite3 data/restaurants.db
sqlite> SELECT name, location, cuisines, rating FROM restaurants WHERE location LIKE '%Koramangala%' ORDER BY rating DESC LIMIT 10;
```

Or point a GUI tool (DB Browser for SQLite, TablePlus, etc.) directly at the file. This is a debugging convenience only — the app itself never reads `restaurants.db`, only `restaurants.parquet`. It's gitignored and safe to delete/regenerate anytime (re-run the script after refreshing the dataset with `python app.py --refresh`). The raw scraped `reviews` column is excluded from the export (unused by the app, and adds ~90MB across the full dataset).
