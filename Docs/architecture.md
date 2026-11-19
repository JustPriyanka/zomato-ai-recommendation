# Architecture: AI-Powered Restaurant Recommendation System

## 1. System Overview

The Zomato Restaurant Recommendation System is a Python-based application that combines structured restaurant data with a Large Language Model (LLM) to deliver personalized, explainable dining recommendations. The system follows a **Retrieval-Augmented Generation (RAG)** pattern — structured filtering retrieves relevant candidates, and the LLM generates ranked, human-readable recommendations.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER INTERFACE                               │
│                  (Streamlit / CLI / Web UI)                          │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ User Preferences
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     APPLICATION LAYER                                │
│                        (app.py)                                      │
│         Orchestrates input → filtering → LLM → output               │
└────────┬─────────────────────────────────┬──────────────────────────┘
         │                                 │
         ▼                                 ▼
┌─────────────────────┐         ┌──────────────────────────┐
│    DATA LAYER       │         │   RECOMMENDATION ENGINE  │
│  (data/loader.py)   │         │ (engine/recommender.py)  │
│                     │         │                          │
│  • HuggingFace API  │         │  • Prompt Construction   │
│  • Data Cleaning    │◄────────│  • LLM API Call          │
│  • Local Caching    │ filtered│  • Response Parsing      │
│  • Pandas DataFrame │  data   │  • Error Handling        │
└─────────┬───────────┘         └────────────┬─────────────┘
          │                                  │
          ▼                                  ▼
┌─────────────────────┐         ┌──────────────────────────┐
│   FILTER ENGINE     │         │      LLM PROVIDER        │
│ (engine/filter.py)  │         │        (Groq)            │
│                     │         │                          │
│  • Location Match   │         │  • Llama API (via Groq)  │
│  • Cuisine Match    │         │  • Token Management      │
│  • Budget Filter    │         │  • Rate Limiting         │
│  • Rating Filter    │         └──────────────────────────┘
└─────────────────────┘
```

## 2. Component Architecture

### 2.1 Project Structure

```
Zomato Recommendation App/
├── Docs/
│   ├── problemstatement.md        # Problem definition and requirements
│   └── architecture.md            # This document
├── data/
│   ├── __init__.py
│   ├── loader.py                  # Dataset loading, cleaning, caching
│   └── cache/                     # Local parquet cache (gitignored)
│       └── restaurants.parquet
├── engine/
│   ├── __init__.py
│   ├── filter.py                  # Structured data filtering logic
│   └── recommender.py             # LLM prompt building and response parsing
├── models/
│   ├── __init__.py
│   └── schemas.py                 # Pydantic data models
├── app.py                         # Entry point / UI layer
├── config.py                      # Configuration and environment management
├── requirements.txt               # Python dependencies
├── .env                           # API keys (gitignored)
├── .env.example                   # Template for environment variables
├── .gitignore
└── README.md
```

### 2.2 Component Responsibilities

| Component | File(s) | Responsibility |
|-----------|---------|----------------|
| **Data Loader** | `data/loader.py` | Downloads dataset from Hugging Face, cleans and normalizes fields, caches locally as Parquet |
| **Filter Engine** | `engine/filter.py` | Applies structured filters (location, cuisine, budget, rating) to narrow candidates |
| **Recommender** | `engine/recommender.py` | Constructs LLM prompt with user preferences + candidate data, calls API, parses response |
| **Schemas** | `models/schemas.py` | Defines `UserPreferences`, `Restaurant`, and `Recommendation` Pydantic models |
| **Config** | `config.py` | Loads environment variables, defines defaults, validates configuration |
| **App** | `app.py` | Orchestrates the full pipeline and handles user interaction |

## 3. Data Architecture

### 3.1 Dataset Schema (Raw → Cleaned)

The Zomato dataset from Hugging Face contains the following fields. The cleaning pipeline transforms raw values into usable types:

| Raw Field | Cleaned Field | Type | Cleaning Logic |
|-----------|---------------|------|----------------|
| `name` | `name` | `str` | Strip whitespace |
| `url` | `url` | `str` | Kept as-is |
| `address` | `address` | `str` | Strip whitespace |
| `online_order` | `online_order` | `bool` | "Yes" → `True`, "No" → `False` |
| `book_table` | `book_table` | `bool` | "Yes" → `True`, "No" → `False` |
| `rate` | `rating` | `float \| None` | Extract numeric from "4.1/5", handle "NEW", "-", None |
| `votes` | `votes` | `int` | Kept as-is |
| `phone` | `phone` | `str` | Kept as-is |
| `location` | `location` | `str` | Strip, lowercase for matching |
| `rest_type` | `restaurant_type` | `str` | Strip whitespace |
| `dish_liked` | `popular_dishes` | `list[str]` | Split by comma, strip each |
| `cuisines` | `cuisines` | `list[str]` | Split by comma, strip each |
| `approx_cost(for two people)` | `cost_for_two` | `int \| None` | Remove commas, cast to int |
| `reviews_list` | `reviews` | `str` | Kept as-is (used for LLM context) |
| `menu_item` | `menu_items` | `str` | Kept as-is |
| `listed_in(type)` | `listing_type` | `str` | Strip whitespace (e.g., Buffet, Delivery) |
| `listed_in(city)` | `city` | `str` | Strip whitespace |

### 3.2 Data Flow Pipeline

```
Hugging Face API
       │
       ▼
  ┌──────────┐     ┌──────────────┐     ┌─────────────────┐
  │ Download  │────▶│  Clean &     │────▶│ Cache as        │
  │ Dataset   │     │  Normalize   │     │ Parquet (local)  │
  └──────────┘     └──────────────┘     └────────┬────────┘
                                                  │
                                    On subsequent runs,
                                    load from cache
                                                  │
                                                  ▼
                                         ┌────────────────┐
                                         │ Pandas         │
                                         │ DataFrame      │
                                         │ (in memory)    │
                                         └────────────────┘
```

### 3.3 Caching Strategy

- **First run**: Download from Hugging Face → clean → save to `data/cache/restaurants.parquet`
- **Subsequent runs**: Load directly from Parquet (fast, no internet required)
- **Cache invalidation**: Manual deletion of `data/cache/` or a `--refresh` CLI flag

## 4. Filtering Architecture

The filter engine applies structured, deterministic filters before the LLM is invoked. This ensures the LLM only sees relevant candidates, keeping token usage low and responses focused.

### 4.1 Filter Chain

Filters are applied sequentially. Each filter narrows the dataset further:

```
Full Dataset (~12,500 unique restaurants, deduplicated from ~52,000 raw scrape rows)
       │
       ├── 1. Location Filter (case-insensitive partial match)
       │        Matches against `location` only (`city` is a scrape-category
       │        artifact, not a reliable location signal - see edge-cases.md #1.9)
       │
       ├── 2. Cuisine Filter (any-overlap match)
       │        User's cuisine list ∩ restaurant's cuisine list ≠ ∅
       │
       ├── 3. Budget Filter (cost_for_two ranges)
       │        Low: ≤ 300 | Medium: 300–700 | High: > 700
       │
       ├── 4. Rating Filter (minimum threshold)
       │        rating >= user's min_rating
       │
       ├── 5. Optional Filters
       │        online_order, book_table, restaurant_type
       │
       └── 6. Sort & Limit
                Sort by rating (desc), votes (desc)
                Return top N candidates (default: 20)
                        │
                        ▼
              Candidate DataFrame (≤ 20 rows)
```

### 4.2 Budget Mapping

| Budget Level | Cost for Two (₹) | Description |
|-------------|-------------------|-------------|
| Low | ≤ 300 | Street food, quick bites, small cafés |
| Medium | 301 – 700 | Casual dining, mid-range restaurants |
| High | > 700 | Fine dining, premium experiences |

### 4.3 Edge Cases

| Scenario | Behavior |
|----------|----------|
| No restaurants match all filters | Relax filters progressively: rating → budget → cuisine → location |
| Too few results (< 5) | Widen budget range or lower rating threshold |
| Missing data in fields | Exclude row from that specific filter (not from entire result set) |
| User provides no preferences | Return top-rated restaurants across all locations |

## 5. LLM Integration Architecture

### 5.1 Prompt Engineering Strategy

The prompt follows a structured format to ensure consistent, high-quality LLM output:

```
┌─────────────────────────────────────────────────┐
│                SYSTEM PROMPT                     │
│  Role: Expert restaurant recommendation engine   │
│  Constraints: Use only provided data, no         │
│  hallucination, structured JSON output           │
└─────────────────────────┬───────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────┐
│                USER PROMPT                       │
│                                                  │
│  Section 1: User Preferences                     │
│  ┌─────────────────────────────────────────┐    │
│  │ Location: Bangalore                      │    │
│  │ Budget: Medium                           │    │
│  │ Cuisine: Italian, Chinese                │    │
│  │ Min Rating: 4.0                          │    │
│  │ Notes: Family-friendly, outdoor seating  │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
│  Section 2: Candidate Restaurants (JSON array)   │
│  ┌─────────────────────────────────────────┐    │
│  │ [                                        │    │
│  │   { name, location, cuisines, cost,      │    │
│  │     rating, votes, type, popular_dishes },│    │
│  │   ...                                    │    │
│  │ ]                                        │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
│  Section 3: Instructions                         │
│  - Rank top 5 restaurants                        │
│  - Explain why each fits the user's preferences  │
│  - Return structured JSON response               │
└─────────────────────────────────────────────────┘
```

### 5.2 LLM Response Schema

The LLM is instructed to return a JSON response conforming to:

```json
{
  "recommendations": [
    {
      "rank": 1,
      "restaurant_name": "Truffles",
      "location": "Koramangala, Bangalore",
      "cuisines": ["Italian", "Continental"],
      "cost_for_two": 600,
      "rating": 4.5,
      "explanation": "Truffles is an excellent match because...",
      "highlights": ["Family-friendly", "Popular Italian dishes", "Great reviews"]
    }
  ],
  "summary": "Based on your preferences for Italian/Chinese cuisine in Bangalore with a medium budget..."
}
```

### 5.3 Token Management

| Element | Estimated Tokens |
|---------|-----------------|
| System prompt | ~200 |
| User preferences | ~100 |
| 20 candidate restaurants | ~2,000–3,000 |
| Instructions | ~150 |
| **Total input** | **~2,500–3,500** |
| Expected output | ~800–1,200 |
| **Total per request** | **~3,500–4,500** |

### 5.4 Error Handling for LLM

| Error Type | Handling Strategy |
|------------|-------------------|
| API key missing/invalid | Raise clear error with setup instructions |
| Rate limit (429) | Exponential backoff with 3 retries |
| Timeout | Retry once, then return filtered results without LLM ranking |
| Malformed JSON response | Attempt JSON repair, fallback to unstructured parsing |
| Empty response | Return filtered candidates with a note that LLM ranking is unavailable |
| Context length exceeded | Reduce candidate count and retry |

## 6. Data Models (Pydantic Schemas)

### 6.1 UserPreferences

```python
class UserPreferences(BaseModel):
    location: Optional[str] = None
    cuisines: Optional[List[str]] = None
    budget: Optional[Literal["low", "medium", "high"]] = None
    min_rating: Optional[float] = Field(None, ge=0.0, le=5.0)
    restaurant_type: Optional[str] = None
    online_order: Optional[bool] = None
    book_table: Optional[bool] = None
    additional_notes: Optional[str] = None
```

### 6.2 Restaurant

```python
class Restaurant(BaseModel):
    name: str
    url: Optional[str] = None
    address: Optional[str] = None
    location: str
    city: Optional[str] = None
    cuisines: List[str]
    cost_for_two: Optional[int] = None
    rating: Optional[float] = None
    votes: int = 0
    online_order: bool = False
    book_table: bool = False
    restaurant_type: Optional[str] = None
    popular_dishes: Optional[List[str]] = None
    phone: Optional[str] = None
```

### 6.3 Recommendation

```python
class Recommendation(BaseModel):
    rank: int
    restaurant: Restaurant
    explanation: str
    highlights: Optional[List[str]] = None
```

## 7. Request Lifecycle

A complete request flows through the system as follows:

```
 ① User launches app
         │
         ▼
 ② Load dataset (from cache or Hugging Face)
         │
         ▼
 ③ Collect user preferences (interactive prompts)
         │
         ▼
 ④ Validate preferences (Pydantic model)
         │
         ▼
 ⑤ Apply structured filters → candidate DataFrame
         │
         ├── No results? → Relax filters, retry
         │
         ▼
 ⑥ Build LLM prompt (preferences + candidates)
         │
         ▼
 ⑦ Call LLM API (with retry logic)
         │
         ├── API failure? → Return filtered results without LLM ranking
         │
         ▼
 ⑧ Parse LLM response → List[Recommendation]
         │
         ▼
 ⑨ Display recommendations to user
         │
         ├── Restaurant details (name, location, cost, rating)
         ├── LLM-generated explanation for each pick
         └── Overall summary
```

## 8. Configuration Management

All configuration is managed via environment variables with sensible defaults:

| Variable | Default | Description |
|----------|---------|-------------|
| `GROQ_API_KEY` | (required) | API key for Groq |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Model to use for recommendations |
| `MAX_CANDIDATES` | `20` | Max restaurants passed to LLM |
| `TOP_K` | `5` | Number of recommendations to return |
| `CACHE_DIR` | `data/cache` | Directory for cached dataset |
| `LOG_LEVEL` | `INFO` | Logging verbosity |

## 9. Dependencies

| Package | Purpose |
|---------|---------|
| `groq` | Groq API client (free-tier LLM inference, OpenAI-compatible) |
| `datasets` | Load Hugging Face datasets |
| `pandas` | Data manipulation and filtering |
| `pydantic` | Data validation and schemas |
| `python-dotenv` | Load `.env` files |
| `rich` | Beautiful terminal output (tables, panels, progress bars) |
| `pyarrow` | Parquet file support for caching |

## 10. Future Extensions

These are not in scope for the initial build but are natural next steps:

| Extension | Description |
|-----------|-------------|
| **Vector Search (Full RAG)** | Embed restaurant descriptions using sentence-transformers, store in ChromaDB/FAISS, enable semantic search |
| **Streamlit UI** | Web-based frontend with interactive filters, maps, and restaurant cards |
| **Conversation Memory** | Remember past preferences and refine recommendations across sessions |
| **Multi-city Support** | Extend beyond Bangalore to Delhi, Mumbai, etc. (dataset covers multiple cities) |
| **Review Sentiment** | Analyze review text to surface sentiment-based insights |
| **User Feedback Loop** | Let users rate recommendations to improve future suggestions |
