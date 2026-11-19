# Edge Cases: AI-Powered Restaurant Recommendation System

Derived from `architecture.md` (documented design/edge-case table) and `implementation-plan.md` (phase status), cross-checked against the current code in `data/loader.py`, `engine/filter.py`, `engine/recommender.py`, `models/schemas.py`, `config.py`, and `app.py`.

**Status legend:** 🔴 Unhandled (will crash or silently misbehave) · 🟡 Partially handled · 🟢 Handled

---

## 1. Data Ingestion (`data/loader.py`) — Phase 1

| # | Edge Case | Status | Notes |
|---|-----------|--------|-------|
| 1.1 | Hugging Face API unreachable / network failure on first run (no cache yet) | 🟡 | `load_dataset` call is unguarded; exception propagates up to `app.py`'s broad `try/except` around `load_and_clean_data`, which prints an error and exits. Acceptable but generic — no distinction between "no internet" vs. "dataset renamed/removed." |
| 1.2 | Upstream dataset schema changes (columns renamed/removed) | 🔴 | Only `approx_cost(for two people)`, `listed_in(type)`, `listed_in(city)` are guarded with `if col in df.columns`. All other accesses (`df["name"]`, `df["rate"]`, `df["votes"]`, `df["cuisines"]`, `df["online_order"]`, etc.) are unguarded — a `KeyError` here is not caught anywhere and crashes on startup. |
| 1.3 | Corrupted or partially-written cached Parquet file | 🔴 | `pd.read_parquet(cache_path)` has no try/except. A corrupt cache (e.g., killed mid-write) crashes every subsequent run until the file is manually deleted. |
| 1.4 | Cache goes stale (upstream dataset updated on HF) | 🟡 | Architecture doc mentions cache invalidation via manual deletion or a `--refresh` flag; the `refresh` parameter exists in `load_and_clean_data()` but no CLI flag wires it up (tracked in implementation-plan Phase 1). |
| 1.5 | Empty dataset returned (0 rows) | 🟢 | Cleaning proceeds on an empty frame; downstream `filter_restaurants` checks `df.empty` and returns early; `app.py` shows "No candidates found." |
| 1.6 | Malformed rating strings beyond `"NEW"`/`"-"`/`"nan"` (e.g., `"4.1 / 5"`, `"Not rated"`, non-English text) | 🟡 | `extract_rating` uses a regex for `\d+\.\d+` — anything without a decimal number silently becomes `None` rather than raising, which is safe but could mask systematic parsing failures if the upstream format changes wholesale. |
| 1.7 | `cost_for_two` values with currency symbols or decimals (e.g., `"₹1,200"`, `"500.00"`) | 🟡 | `clean_cost` strips commas only; a currency symbol or decimal point makes `int()` fail, silently returning `None` rather than attempting further cleanup. |
| 1.8 | `CACHE_DIR` path not writable (permissions issue) | 🔴 | `config.py` runs `CACHE_DIR.mkdir(parents=True, exist_ok=True)` at import time with no guard — raises `PermissionError` before the app even starts, with a raw traceback. |
| 1.9 | Raw dataset repeats each restaurant once per `(listed_in(city), listed_in(type))` scrape page it was captured under | 🟢 | Discovered via direct data inspection: 51,717 raw rows collapse to 12,499 unique `(name, address)` restaurants — ~76% were duplicates. `city` itself is a scrape-category artifact, not the restaurant's real location (e.g. a restaurant on "Hosur Road" was tagged under `city` values like "BTM", "HSR", "Koramangala 4th/5th/6th/7th Block"). Fixed: `clean_data()` now dedupes on `(name, address)`, keeping the highest-vote copy; verified this correctly preserves genuine distinct chain branches (e.g. 54 real Cafe Coffee Day locations) while collapsing true duplicates. |

---

## 2. Data Models (`models/schemas.py`) — Phase 2

| # | Edge Case | Status | Notes |
|---|-----------|--------|-------|
| 2.1 | `Restaurant.rating` has no bounds validation (unlike `UserPreferences.min_rating`, which is `ge=0.0, le=5.0`) | 🟢 | Fixed — `rating` now uses `Field(None, ge=0.0, le=5.0)`, matching `UserPreferences`. A malformed upstream rating outside 0–5 now raises `ValidationError` instead of passing through silently. |
| 2.2 | Duplicate restaurant names in the dataset (e.g., chain locations "Truffles - Koramangala" vs. "Truffles - Indiranagar" sharing an identical `name` field) | 🔴 | See §4.5 below — this is really a recommender-layer bug but rooted in the model having no unique identifier field (no restaurant ID). |

---

## 3. Filter Engine (`engine/filter.py`) — Phase 3

| # | Edge Case | Status | Notes |
|---|-----------|--------|-------|
| 3.1 | `min_rating == 0.0` passed programmatically (not via CLI) | 🔴 | `if prefs.min_rating:` treats `0.0` as falsy, so the rating filter is silently skipped instead of applying "rating ≥ 0" (a no-op, but semantically different from "filter not requested"). `app.py` currently avoids this by converting `0.0` → `None` before constructing `UserPreferences`, but any other caller (e.g., a future Streamlit form) would hit it. |
| 3.2 | Rows with missing `cost_for_two` when a budget filter is active | 🟡 | `architecture.md` §4.3 says missing data should be "excluded from that specific filter, not the entire result set." Current behavior: `None`/`NaN` comparisons evaluate `False` in pandas, so rows with unknown cost are dropped entirely rather than retained-with-uncertainty. Same issue for `rating` with an active rating filter. |
| 3.3 | "Too few results (< 5)" case from `architecture.md` §4.3 | 🟢 | Fixed — `MIN_CANDIDATES_THRESHOLD = 5` added; budget and rating filters now widen (drop the constraint) when they leave a nonzero-but-thin result set, applied only if it actually yields more candidates. Verified with synthetic fixtures for thin-budget, thin-rating, sufficient-count (no widen), and pre-existing empty-result relaxation (no regression). |
| 3.4 | Location substring over-matching (e.g., searching `"pune"` matches `"Puneri Galli"` restaurants outside Pune, or a bare space matching almost everything) | 🟡 | `str.contains` is a plain substring match — no word-boundary or fuzzy matching. A location input of just whitespace (`" "`) isn't stripped/nulled before filtering, so it acts as a near-universal match rather than "no location filter." |
| 3.4b | Location filter previously also matched the noisy `city` field, causing false positives (see #1.9) | 🟢 | Fixed — `_apply_location_filter` now matches `location` only. Verified against real data: a restaurant on "Hosur Road" no longer matches a "Koramangala 4th Block" search (it previously did, purely via the `city` scrape-tag), while genuine `location`-based matches are unaffected (7,782 rows for a "Koramangala" search, unchanged). |
| 3.5 | Optional filters (`online_order`, `book_table`, `restaurant_type`) relax as a group, not individually | 🟡 | If a user wants both `online_order=True` and a specific `restaurant_type`, and only one is jointly satisfiable, the code reverts to `state` (pre-optional-filter results) rather than trying each optional filter independently to see which one is salvageable. |
| 3.6 | Recursive relaxation always restarts from the **original** `df`, not the partially-filtered `state` | 🟢 (by design, verified correct) | Confirmed intentional — prevents compounding filter loss, but worth documenting: each relaxation step effectively reruns the whole filter chain minus one criterion, which is correct behavior, just not obvious from a first read. |
| 3.7 | Infinite recursion risk | 🟢 | Bounded — each recursive call nulls exactly one more field in a fixed order (location → cuisine → budget → rating); base case (all four `None`) can't recurse further. No risk found. |

---

## 4. LLM Recommender (`engine/recommender.py`) — Phase 4

| # | Edge Case | Status | Notes |
|---|-----------|--------|-------|
| 4.0 | `df_to_json_candidates()` and the response-mapping step crash on any real row with a multi-value `cuisines`/`popular_dishes` field | 🟢 | **Critical bug, discovered via a live end-to-end test (real Groq API call against real cached data) — never caught by any mocked test because those used single-element lists.** Root cause: parquet round-trips Python lists as numpy arrays; `pd.notna(v)`/`pd.isna(v)` on an array with >1 element raises `ValueError: truth value of an array... is ambiguous`, and even a 1-element array had a second latent bug (raw `ndarray` isn't JSON-serializable). This meant `get_recommendations()` crashed on essentially every real restaurant with more than one cuisine - i.e. most of the dataset. Fixed in both locations (`df_to_json_candidates` and the recommendation-mapping loop) by explicitly converting `list`/`np.ndarray` values to plain Python lists before any NaN check. Verified with a live Groq call end-to-end (`app.py` full run) after the fix. |
| 4.1 | Rate limiting (HTTP 429) | 🟢 | Fixed — `_call_groq_with_retry()` retries up to `MAX_RATE_LIMIT_RETRIES` (3) with exponential backoff + jitter, matching architecture.md §5.4. Verified with a mocked client (2 failures then success; and exhausting all retries then giving up gracefully). |
| 4.2 | Request timeout | 🟢 | Fixed — one retry on `groq.APITimeoutError`, then falls back gracefully. Verified with a mocked client for both the retry-then-succeed and retry-then-fail-again paths. |
| 4.3 | Context length exceeded (candidate list too large for the model) | 🟢 | Fixed — on a `BadRequestError` whose message matches context-length wording, candidate count is halved and retried (down to a floor of 1) before giving up. Verified with a mocked client that a 20-candidate payload converges to a size the "model" accepts. |
| 4.4 | LLM returns `restaurant_name` that doesn't exactly match any candidate (hallucination, casing/whitespace mismatch, or paraphrasing despite the "don't hallucinate" instruction) | 🔴 | `candidates_df[candidates_df["name"] == name]` is an exact match; a non-match is silently dropped from `final_recommendations` with **no warning**. Worst case: all recommendations get dropped, so `LLMResponse.recommendations == []` while `summary` is still populated — `app.py` would show a summary panel with zero restaurant cards beneath it, which reads as broken rather than "no results." |
| 4.5 | Duplicate restaurant names among candidates (e.g., two branches of the same chain) | 🔴 | `match.iloc[0]` silently picks the first matching row — the displayed address/cost/rating could belong to the wrong branch of a same-named restaurant. Root cause: no unique ID field (see §2.2). |
| 4.6 | LLM adds conversational preamble/postamble despite "output nothing but valid JSON" instruction, without wrapping in a ` ```json ` fence | 🟡 | Only exact `\`\`\`json` / `\`\`\`` prefixes/suffixes are stripped; any other extra text (e.g., "Sure, here's the JSON:") breaks `json.loads`, caught by the generic except, and the raw response is printed to console for debugging — but the user just sees a degraded fallback with no explanation. |
| 4.7 | LLM returns malformed/incomplete JSON (e.g., stray preamble text, trailing commas) | 🟢 | Fixed — `_try_repair_json()` attempts raw parse, then `{...}` block extraction (strips preamble/postamble), then trailing-comma stripping, before giving up. Verified against all three cases plus a genuinely non-JSON string (correctly returns `None`). A hard truncation mid-object (from hitting `max_tokens`) is still unrecoverable by design — no retry with a higher token budget yet. |
| 4.8 | Duplicate or invalid `rank` values from the LLM (e.g., two recommendations both ranked `1`, or a rank of `0`) | 🔴 | No validation — `sorted(..., key=lambda x: x.rank)` will silently produce a confusing display order (e.g., two "#1" panels) rather than rejecting/renumbering. |
| 4.9 | `message.content` is empty or its first block isn't text (e.g., a safety-related refusal with a different content type) | 🟡 | `message.content[0].text` would raise `IndexError`/`AttributeError`, caught by the broad `except Exception`, degrading to raw results — functional but gives no useful diagnostic to the user about *why* the LLM call "failed." |
| 4.10 | Invalid or revoked API key | 🟢 | Caught by `groq.APIError`, clear message printed, graceful fallback. |

---

## 5. CLI Application (`app.py`) — Phase 5

| # | Edge Case | Status | Notes |
|---|-----------|--------|-------|
| 5.1 | `Ctrl+C` / `KeyboardInterrupt` during any prompt | 🔴 | Not caught anywhere in `main()` — raises a raw traceback to the terminal instead of exiting cleanly with a friendly message. |
| 5.2 | User enters `0.0` for minimum rating intending "any rating ≥ 0" vs. just hitting Enter on the default | 🟡 | Both are indistinguishable and both get converted to `None` (filter skipped entirely). Functionally harmless here since 0 is a no-op threshold anyway, but worth noting as a minor UX ambiguity if requirements ever need "explicitly show even unrated restaurants" vs. "no preference." |
| 5.3 | Location input of only whitespace | 🔴 | Not stripped before being passed into `UserPreferences` — combined with §3.4, this can produce a near-universal substring match rather than being treated as "no location specified." |
| 5.4 | Budget `Prompt.ask` with `choices=["low","medium","high",""]` | 🟢 | Verified this works as intended — empty string is a valid explicit choice (default), so pressing Enter with no input is accepted. |

---

## 6. Configuration (`config.py`) — Phase 0

| # | Edge Case | Status | Notes |
|---|-----------|--------|-------|
| 6.1 | Non-integer values for `MAX_CANDIDATES` / `TOP_K` in `.env` (e.g., `TOP_K=five`) | 🔴 | `int(os.getenv(...))` runs at import time with no guard — crashes the entire app before any UI renders, with a raw `ValueError` traceback and no hint that it's an env misconfiguration. |
| 6.2 | Missing `GROQ_API_KEY` | 🟢 | Handled explicitly in `get_recommendations` with a clear error message and graceful `None` return. |

---

## 7. Forward-Looking: Streamlit UI (Phase 7, not yet built)

These aren't bugs yet since the code doesn't exist, but flagging them now since `implementation-plan.md` prioritizes this phase next:

| # | Edge Case | Why it matters |
|---|-----------|-----------------|
| 7.1 | All current `console.print(...)` (`rich`) calls in `loader.py` and `recommender.py` write to stdout, not to a web UI | These will need to be replaced or suppressed for a Streamlit frontend — currently tightly coupled to CLI output. |
| 7.2 | Streamlit's rerun-on-every-interaction model | Without `st.cache_data`/`st.session_state`, every widget tweak would re-download/re-clean the dataset and/or re-call the LLM, burning API costs and load time. |
| 7.3 | Concurrent multi-user sessions sharing one on-disk Parquet cache | Fine for read-only access; only a risk if a future "refresh" action writes the cache while another session reads it. |

---

## Priority Recommendations

Highest-impact fixes first, since they cause hard crashes rather than degraded-but-functional behavior:

1. **6.1 / 1.8** — guard config parsing (`int()`, `mkdir`) with clear startup error messages instead of raw tracebacks.
2. **1.2 / 1.3** — guard dataset schema access and Parquet reads; both currently crash on any upstream/cache irregularity.
3. **4.1–4.3** — retry/backoff logic (already scoped as implementation-plan Phase 6); closes the biggest gap between documented and actual behavior.
4. **4.4 / 4.8** — validate LLM output (name matching, rank uniqueness) before rendering, so a bad LLM response degrades visibly instead of silently producing an empty or confusing display.
5. **5.1** — wrap `main()`'s loop in a `KeyboardInterrupt` handler for a clean exit.
