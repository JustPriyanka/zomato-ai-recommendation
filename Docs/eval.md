# Evaluation Plan: AI-Powered Restaurant Recommendation System

Derived from `architecture.md` (system contracts: filter chain, LLM prompt/response schema, constraints like "no hallucination") and `implementation-plan.md` (Phase 8 — Testing & Validation, currently ⬜ not started). This doc turns Phase 8 into a concrete eval methodology, split by what's **deterministic** (unit-testable, exact pass/fail) vs. what's **LLM-generated** (needs a different evaluation approach — behavioral/statistical, not exact-match).

---

## 1. Why Two Eval Tracks

The system has a hard boundary at the filter → LLM handoff (`architecture.md` §1, the RAG-pattern diagram):

- **Retrieval side** (`data/loader.py`, `engine/filter.py`) is pure Python/pandas — same input always produces the same output. Standard unit tests with exact assertions are sufficient and should be the majority of coverage.
- **Generation side** (`engine/recommender.py`, the Groq LLM call) is non-deterministic even at `temperature=0.3`. It needs **contract evals** (does the output obey the rules the system prompt demands, e.g. "only recommend given candidates") and **quality evals** (are the picks/explanations actually good), which require sampling and rubrics rather than single exact-match assertions.

Treat retrieval bugs as regressions (should never happen, block release). Treat generation quality as a trend to monitor (some variance is expected; watch for degradation, not perfection).

---

## 2. Track A — Deterministic Component Evals

### 2.1 Data Cleaning (`data/loader.py`)

| Test | Input | Expected Output |
|---|---|---|
| Rating extraction | `"4.1/5"`, `"NEW"`, `"-"`, `None`, `"3.5"` | `4.1`, `None`, `None`, `None`, `3.5` |
| Cost parsing | `"1,200"`, `"800"`, `"N/A"`, `None` | `1200`, `800`, `None`, `None` |
| List parsing | `"Italian, Chinese"`, `""`, `None` | `["Italian", "Chinese"]`, `[]`, `[]` |
| Boolean normalization | `"Yes"`, `"No"`, `"yes"` (case), `None` | `True`, `False`, `True`, `False` |
| Missing optional columns (`approx_cost...`, `listed_in(type)`, `listed_in(city)`) | Column absent from raw df | Cleaned column is `None`, no crash |

**Gap called out in `edge-cases.md` #1.2:** add a schema-presence check (assert required raw columns exist) as its own test, since currently a missing *required* column (e.g. `name`, `rate`, `cuisines`) raises an unguarded `KeyError` — the eval here is "does loading fail loudly with a clear message," not "does it silently succeed."

**Pass criterion:** 100% exact match on fixture inputs. Any failure blocks merge.

### 2.2 Filter Engine (`engine/filter.py`)

Build a small fixture DataFrame (~15–20 synthetic rows) covering: multiple cities, overlapping/non-overlapping cuisines, a spread of costs across all three budget bands, a spread of ratings, some rows with `NaN` cost/rating, some with `online_order`/`book_table` combinations.

| Test | Scenario | Expected |
|---|---|---|
| Single filter correctness | Each filter (location, cuisine, budget, rating, optional) applied alone | Only matching rows returned |
| Combined filters | Location + cuisine + budget + rating together | Intersection of all four |
| Empty-result relaxation | A combination guaranteed to return zero rows | Recursion drops fields in the documented order (location → cuisine → budget → rating) until non-empty, verified via the *actual* returned rows, not just non-emptiness |
| Optional-filter revert | Optional filters jointly empty the set | Reverts to pre-optional-filter `state` |
| Sort order | Any successful filter | Descending by rating, then votes |
| `MAX_CANDIDATES` cap | Filter matches more than the configured max | Result length == `MAX_CANDIDATES`, and it's the *top* N by rating/votes, not an arbitrary N |
| `min_rating == 0.0` truthiness bug (`edge-cases.md` #3.1) | Pass `min_rating=0.0` directly (bypassing `app.py`'s conversion to `None`) | Document actual behavior (filter skipped) as a regression-locking test — either accept it as intended or fix and update the test |
| Missing-data exclusion (`edge-cases.md` #3.2) | Rows with `NaN` cost/rating, budget or rating filter active | Document current behavior (row excluded) as a baseline; flag as a known deviation from `architecture.md` §4.3 |

**Pass criterion:** 100% exact match against expected row sets. This is the highest-value test suite in the project — it locks in the most complex logic (recursive relaxation) against silent regressions.

### 2.3 Schemas (`models/schemas.py`)

- Valid/invalid construction for each model (e.g., `budget` outside `{low, medium, high}` raises `ValidationError`; `min_rating` outside `[0, 5]` raises).
- Round-trip: `UserPreferences(**prefs.model_dump())` reproduces an identical object.

**Pass criterion:** validation errors raised exactly where expected, no false positives/negatives.

---

## 3. Track B — LLM Recommendation Evals

Run against a **golden set** of ~10–15 representative preference scenarios (see §3.3), each paired with a fixed candidate list (frozen fixture, not live-downloaded data, so results are comparable run-over-run). Re-run the golden set whenever the prompt, model version, or `TOP_K`/`MAX_CANDIDATES` changes.

### 3.1 Contract Evals (must pass at ~100%; these encode `architecture.md` §5's hard constraints)

| Metric | Definition | Target |
|---|---|---|
| **Schema compliance rate** | % of responses that parse as valid JSON matching the documented schema on the first attempt (no markdown-fence cleanup needed) | ≥ 95% |
| **Groundedness (no hallucination)** | % of `restaurant_name` values in the response that exact-match a name in the candidate list sent to the model | 100% — any miss is a contract violation per `architecture.md` §5.1 constraint #1 |
| **Rank validity** | Ranks are unique integers, 1..N with no gaps/duplicates (closes `edge-cases.md` #4.8) | 100% |
| **Count compliance** | Number of recommendations returned == `min(TOP_K, len(candidates))` | ≥ 95% |
| **Latency** | Time from request to parsed response | p50 < 5s, p95 < 12s (adjust once a baseline exists) |

A schema-compliance or groundedness failure should be logged with the raw response for prompt debugging — these are the metrics most likely to catch prompt regressions after a model upgrade.

### 3.2 Quality Evals (directional, some subjectivity expected)

| Metric | Method | Target |
|---|---|---|
| **Preference relevance** | For each recommendation, deterministically check: does the restaurant's actual `cuisines`/`cost_for_two`/`rating` in the candidate data satisfy the user's stated filters? (This is checkable in code, not just by eye, since the candidate data is structured.) | ≥ 90% of recommended restaurants should satisfy all *hard* filters the user specified |
| **Explanation groundedness** | Spot-check (manual or LLM-as-judge): does the explanation reference details actually present in the candidate's data (cuisine, cost, rating, popular dishes) rather than inventing details? | No fabricated specifics in a manual review of the golden set |
| **Explanation usefulness** | LLM-as-judge rubric (1–5): personalized, non-generic, references user's stated preferences by name | Median ≥ 4 |
| **Summary quality** | Manual review: does `summary` accurately reflect the actual recommendations returned? | Pass/fail per sample |

LLM-as-judge here means a separate LLM call scoring the *output* against a short rubric — useful for catching generic/boilerplate explanations at scale, but treat it as a signal to sample-check, not an automatic gate, since judge models have their own noise.

### 3.3 Golden Set — Scenario Coverage

Design scenarios to hit the branches actually present in the code, not just "typical" user inputs:

1. Fully specified preferences (location + cuisine + budget + rating) with a healthy candidate count
2. Preferences that trigger filter relaxation (e.g., a cuisine/location combo with zero exact matches)
3. No preferences at all (architecture doc §4.3: "return top-rated restaurants across all locations")
4. Very few candidates (1–3) after filtering — does `TOP_K=5` degrade gracefully to fewer?
5. A candidate set containing near-duplicate restaurant names (stresses `edge-cases.md` #4.5)
6. Preferences with `additional_notes` that aren't structurally filterable (e.g., "family friendly, outdoor seating") — does the LLM meaningfully use free-text notes in its explanation?
7. A budget/rating combination that legitimately returns zero candidates even after full relaxation (empty dataset edge case)

### 3.4 Resilience Evals (once Phase 6 retry/backoff is implemented)

| Test | Method | Expected |
|---|---|---|
| Simulated 429 | Mock client raising rate-limit error N times then succeeding | Retries with backoff, eventually succeeds within retry budget |
| Simulated timeout | Mock client timing out | Retries once per doc spec, then falls back to filtered results |
| Simulated context-length error | Oversized candidate payload | Candidate count reduced and retried, or graceful fallback with a clear message |
| Malformed JSON injection | Mock response with broken JSON | Falls back without crashing; user sees the "LLM ranking unavailable" message, not a stack trace |

---

## 4. Track C — End-to-End Evals

Full pipeline runs (`app.py` logic, minus interactive prompts — call the same functions programmatically) against the golden scenarios in §3.3:

- Confirms the filter → recommender → display handoff doesn't lose or corrupt data at the boundaries (e.g., `Restaurant` model construction from a matched row never raises `ValidationError`).
- Confirms the "empty recommendations but populated summary" failure mode from `edge-cases.md` #4.4 is either fixed or at minimum produces a sensible fallback message rather than a bare summary with no cards.

---

## 5. Tooling

- **Track A (deterministic):** `pytest` with fixtures under a new `tests/` directory (mirrors `implementation-plan.md` Phase 8). No network/API calls — pure and fast, runs in CI on every change.
- **Track B (LLM):** a small standalone eval script (e.g., `evals/run_golden_set.py`) that loads the frozen fixture candidates + golden preference scenarios, calls `get_recommendations`, and computes the Track B metrics. Not part of the standard fast test suite — run on demand (prompt changes, model upgrades, before releases) since it costs real API calls and has non-deterministic output.
- **Track C:** a handful of `pytest` integration tests using a **mocked** Groq client (deterministic fixture responses) so they can run in CI without API cost, plus the separate on-demand Track B script for real-model quality checks.

---

## 6. Release Gate Summary

| Track | When it runs | Blocking? |
|---|---|---|
| A — Deterministic | Every commit (CI) | Yes — any failure blocks merge |
| B — Contract evals | Before release / after prompt or model changes | Yes — schema compliance & groundedness must hit target |
| B — Quality evals | Before release / after prompt or model changes | No (advisory) — flag regressions for review, don't auto-block on subjective scores |
| C — End-to-end | Every commit (CI, mocked LLM) | Yes for the mocked path; real-model E2E is advisory like Track B |

This gives Phase 8 of `implementation-plan.md` a concrete definition of "done": Track A + mocked Track C in CI, plus a repeatable Track B golden-set script for anything touching the prompt or model.
