# Implementation Plan: AI-Powered Restaurant Recommendation System

Derived from `problemstatement.md` (objectives/requirements) and `architecture.md` (system design). Each phase lists its goal, deliverables, and current status based on the codebase as of this writing.

**Status legend:** ✅ Done · 🟡 Partial · ⬜ Not started

---

## Phase 0 — Project Scaffolding
**Goal:** Establish the project skeleton, config, and environment management.

- ✅ Directory structure (`data/`, `engine/`, `models/`, `Docs/`)
- ✅ `config.py` — env-based config via `python-dotenv` (API key, model, `MAX_CANDIDATES`, `TOP_K`, cache dir, log level)
- ✅ `.env.example` template
- ✅ `requirements.txt`
- ✅ `.gitignore` (`.env`, `.venv/`, `__pycache__/`, `data/cache/`, etc.)
- ✅ `README.md` (setup/run instructions)

---

## Phase 1 — Data Ingestion Layer
**Goal:** Load the Zomato dataset and normalize it into a clean, typed DataFrame (per `architecture.md` §3.1).

- ✅ `data/loader.py` — downloads `ManikaSaini/zomato-restaurant-recommendation` from Hugging Face
- ✅ Field cleaning: rating extraction, cost parsing, list-splitting for cuisines/dishes, boolean normalization for `online_order`/`book_table`
- ✅ Local Parquet caching (`data/cache/restaurants.parquet`) with cache-hit short-circuit
- ✅ `--refresh` CLI flag (`app.py`) wired to `load_and_clean_data(refresh=...)`, bypassing the cache on demand
- ✅ Deduplication — discovered the raw dataset repeats each restaurant once per `(listed_in(city), listed_in(type))` scrape page (51,717 raw rows -> 12,499 unique restaurants by `(name, address)`, ~76% duplicates). `clean_data()` now collapses these, keeping the highest-vote copy per restaurant. Cache has been refreshed to reflect this.

---

## Phase 2 — Data Models
**Goal:** Define typed contracts between layers (per `architecture.md` §6).

- ✅ `models/schemas.py` — `UserPreferences`, `Restaurant`, `Recommendation`, `LLMResponse` (Pydantic v2)
- ✅ Validation constraints (e.g., `min_rating` bounded 0–5, `budget` as `Literal`)

---

## Phase 3 — Filter Engine
**Goal:** Deterministic structured filtering to narrow candidates before the LLM call (per `architecture.md` §4).

- ✅ `engine/filter.py` — location, cuisine, budget, rating, optional filters (online order/book table/type)
- ✅ Progressive filter relaxation on empty results (rating → budget → cuisine → location), matching the documented edge-case table
- ✅ Sort by rating desc, votes desc; cap at `MAX_CANDIDATES`
- ✅ "Too few results (< 5) → widen budget/lower rating" — `MIN_CANDIDATES_THRESHOLD = 5` in `engine/filter.py`; budget/rating filters now widen (drop the constraint) when they leave a nonzero but thin result set, only if doing so actually yields more candidates
- ✅ Location filter now matches only against `location` (real, address-derived neighborhood), not `city` (`listed_in(city)`, a scrape-category artifact that caused false-positive matches — e.g. a Hosur Road restaurant matching a "Koramangala" search)

---

## Phase 4 — LLM Recommendation Engine
**Goal:** Construct prompts, call the LLM (Groq), and parse structured output (per `architecture.md` §5).

- ✅ LLM provider migrated from Anthropic (Claude) to [Groq](https://groq.com/) (`openai/gpt-oss-120b`), since the project is open-sourced on GitHub and Groq offers a free tier. Groq's SDK is OpenAI-compatible with an Anthropic-like exception hierarchy (`RateLimitError`, `APITimeoutError`, `BadRequestError`, `APIError`), so the resilience logic ported over directly with no behavior change - only the client construction, message format (system message in the `messages` array instead of a separate `system=` param), and response shape (`response.choices[0].message.content` instead of `message.content[0].text`) changed.
- ✅ `engine/recommender.py` — system + user prompt construction, JSON-only response contract
- ✅ Response parsing back into `Recommendation`/`Restaurant` models, matched by exact name
- ✅ Guards against missing API key and empty candidate sets
- ✅ Rate-limit (429) exponential backoff — `_call_groq_with_retry()` retries up to `MAX_RATE_LIMIT_RETRIES` (3) with exponential backoff + jitter
- ✅ Timeout retry-once-then-fallback — one retry on `groq.APITimeoutError`, then gives up gracefully
- ✅ Context-length-exceeded handling — on `BadRequestError` matching context-length wording, candidate count is halved and retried (floor of 1) before giving up
- ✅ Malformed JSON repair — `_try_repair_json()` attempts raw parse, then `{...}` block extraction, then trailing-comma stripping, before falling back to `None`
- ✅ Fixed a critical live-only bug (see edge-cases.md #4.0): `df_to_json_candidates()` and the response-mapping step crashed on any real restaurant with more than one cuisine, since parquet round-trips list columns as numpy arrays and `pd.notna`/`pd.isna` on a multi-element array raises an ambiguous-truth-value error. Only caught once a real Groq API key was used for a live end-to-end test — every prior mocked test happened to use single-cuisine fixtures.

---

## Phase 5 — CLI Application (Entry Point)
**Goal:** Orchestrate the full pipeline with an interactive terminal UI (per `architecture.md` §7 request lifecycle).

- ✅ `app.py` — header, preference collection (`rich` prompts), filter → LLM → display loop
- ✅ Graceful fallback to raw filtered results when LLM call fails or returns nothing
- ✅ "Search again?" loop with clean exit

---

## Phase 6 — Resilience Hardening
**Goal:** Close the gap between `architecture.md` §5.4's documented error-handling strategy and the current single-shot implementation.

- ✅ Retry/backoff wrapper around the Groq call (429s, timeouts) — implemented in Phase 4 (`_call_groq_with_retry()`)
- ✅ Candidate-count reduction + retry on context-length errors — implemented in Phase 4
- ✅ Lightweight JSON-repair fallback for malformed LLM output — implemented in Phase 4 (`_try_repair_json()`)
- ✅ Surface partial/degraded-mode state clearly to the user — `display_degraded_fallback()` in `app.py` renders a distinct "⚠ Degraded Mode" panel + table (instead of a plain `console.print`) whenever `get_recommendations()` returns `None`

---

## Phase 7 — React.js Web UI
**Goal:** Web-based frontend backed by a FastAPI server, using React.js (Vite + Tailwind CSS). Reuses `data/`, `engine/`, and `models/` unchanged. Visual design sourced from Google Stitch (`Docs/stitch/` prototypes).

- ✅ `api.py` — FastAPI server: `POST /api/recommend` (filter → LLM → response), `GET /api/health`; CORS enabled for local dev; dataset loaded once at startup
- ✅ `frontend/` — Vite + React app with Tailwind CSS tokens matching the Stitch design system
- ✅ `frontend/src/components/PreferenceForm.jsx` — location input, cuisine chip multi-select (keyboard + quick-add), budget 3-button toggle, half-star rating slider, notes textarea
- ✅ `frontend/src/components/ResultsPage.jsx` — green AI summary banner + ranked restaurant cards with highlights and explanations
- ✅ `frontend/src/components/LoadingState.jsx` — spinner + rotating status messages + 3 skeleton cards
- ✅ `frontend/src/components/DegradedFallback.jsx` — yellow warning banner + fallback cards (no explanations/highlights)
- ✅ `frontend/src/components/RestaurantCard.jsx` — shared card component (rank badge, name, location, cuisine chips, cost, rating, optional highlights + explanation)
- ✅ `requirements.txt` updated: `fastapi`, `uvicorn` added; `streamlit` removed

---

## Phase 8 — Testing & Validation
**Goal:** Confidence in filtering logic and data cleaning correctness (not addressed in either source doc, but a natural prerequisite before extending further).

- ⬜ Unit tests for `data/loader.py` cleaning functions (`extract_rating`, `clean_cost`, `parse_list`)
- ⬜ Unit tests for `engine/filter.py` (filter chain + relaxation behavior)
- ⬜ Integration test for `engine/recommender.py` with a mocked Groq client
- ⬜ Sample fixture dataset for fast, offline test runs

---

## Phase 9 — Future Extensions
**Goal:** Capabilities explicitly deferred by `architecture.md` §10 and `problemstatement.md`'s broader vision. Sequenced by likely value/effort.

- ⬜ Multi-city support validation (dataset already covers multiple cities — confirm filter/UI handle this cleanly)
- ⬜ User feedback loop (thumbs up/down on recommendations to inform future ranking)
- ⬜ Conversation memory (persist preferences across sessions)
- ⬜ Review sentiment analysis (surface sentiment insights from `reviews_list`)
- ⬜ Full vector search / RAG (embeddings + ChromaDB/FAISS for semantic candidate retrieval, replacing/augmenting structured filtering)

---

## Suggested Build Order

1. **Phase 6** (resilience hardening) — closes a real gap against the documented spec and touches the highest-risk file (LLM call).
2. **Phase 8** (testing) — lock in current filter/cleaning behavior before further changes risk regressions.
3. **Phase 7** (Streamlit UI) — highest user-visible value, no changes needed to existing engine/data code.
4. **Phase 0 cleanup** (README, .gitignore) — low effort, do whenever convenient.
5. **Phase 9** (future extensions) — pick based on priorities once the above is solid.
