import json
import random
import re
import time
import numpy as np
import pandas as pd
from typing import List, Optional
import groq
from groq import Groq
import sys
from pathlib import Path
from rich.console import Console

# Ensure parent directory is in sys.path
sys.path.append(str(Path(__file__).resolve().parent.parent))
from models.schemas import UserPreferences, Recommendation, Restaurant, LLMResponse
from config import GROQ_API_KEY, GROQ_MODEL, TOP_K

console = Console()

# Retry/backoff tuning (architecture.md §5.4)
MAX_RATE_LIMIT_RETRIES = 3
BASE_BACKOFF_SECONDS = 1.0
CONTEXT_LENGTH_HINTS = ("context", "too long", "maximum context", "prompt is too long")

def df_to_json_candidates(df: pd.DataFrame) -> List[dict]:
    """Convert candidate DataFrame to a lightweight JSON structure for the LLM."""
    candidates = []
    for _, row in df.iterrows():
        # Clean out NaNs for better JSON representation. List/array-typed values
        # (e.g. cuisines, popular_dishes - parquet round-trips these as numpy arrays)
        # are never scalar-NaN, so normalize them to plain Python lists (for JSON
        # serialization) instead of running them through pd.notna(), which raises
        # "truth value of an array is ambiguous" for arrays with more than one element.
        candidate = {}
        for k, v in row.to_dict().items():
            if isinstance(v, (list, np.ndarray)):
                candidate[k] = list(v)
            elif pd.notna(v):
                candidate[k] = v

        # Ensure we only send necessary fields to save tokens
        clean_candidate = {
            "name": candidate.get("name", ""),
            "location": candidate.get("location", ""),
            "city": candidate.get("city", ""),
            "cuisines": candidate.get("cuisines", []),
            "cost_for_two": candidate.get("cost_for_two"),
            "rating": candidate.get("rating"),
            "votes": candidate.get("votes", 0),
            "restaurant_type": candidate.get("restaurant_type", ""),
            "popular_dishes": candidate.get("popular_dishes", []),
            "online_order": candidate.get("online_order", False),
            "book_table": candidate.get("book_table", False)
        }
        candidates.append(clean_candidate)
    return candidates

def _build_system_prompt() -> str:
    return """You are an expert restaurant recommendation engine. 
Your task is to review a list of candidate restaurants and select the best options based on the user's preferences.
You must return your response STRICTLY as a valid JSON object matching this schema:
{
  "recommendations": [
    {
      "rank": <integer>,
      "restaurant_name": "<string, MUST exactly match the name in candidates>",
      "explanation": "<string, why this is a good match based on user preferences and restaurant details>",
      "highlights": ["<string>", "<string>"]
    }
  ],
  "summary": "<string, brief overview of the recommendations>"
}

Constraints:
1. ONLY recommend restaurants provided in the candidate list. Do not hallucinate.
2. Return exactly the requested number of top recommendations, ranked from 1 (best) onwards.
3. Your explanation should be engaging and personalized to the user's input.
4. Output NOTHING but valid JSON. No markdown blocks wrapping the JSON.
"""

def _build_user_prompt(candidates_json: List[dict], prefs: UserPreferences) -> str:
    prefs_dict = {k: v for k, v in prefs.model_dump().items() if v is not None}
    
    return f"""
Section 1: User Preferences
{json.dumps(prefs_dict, indent=2)}

Section 2: Candidate Restaurants
{json.dumps(candidates_json, indent=2)}

Instructions:
- Review the candidates against the user preferences.
- Select the top {TOP_K} best matching restaurants (or fewer if there are less candidates).
- Rank them from 1 to {TOP_K}.
- Provide a clear, personalized explanation for why each is a good fit.
- Return the structured JSON response as specified in the system prompt.
"""

def _try_repair_json(text: str) -> Optional[dict]:
    """Attempt to parse LLM output as JSON, with lightweight repair fallbacks."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Extract the first {...} block in case of stray leading/trailing text
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    # Strip trailing commas before a closing brace/bracket
    repaired = re.sub(r",\s*([}\]])", r"\1", text)
    try:
        return json.loads(repaired)
    except json.JSONDecodeError:
        pass

    return None


def _call_groq_with_retry(
    client: Groq,
    system_prompt: str,
    candidates_json: List[dict],
    prefs: UserPreferences,
):
    """
    Calls Groq with:
    - Exponential backoff retry on rate limits (429)
    - A single retry on timeout
    - Candidate-count reduction + retry on context-length errors
    Returns (response, candidates_used) on success, or (None, candidates_used) on giving up.
    """
    current_candidates = candidates_json
    rate_limit_attempts = 0
    timeout_retried = False

    while True:
        user_prompt = _build_user_prompt(current_candidates, prefs)
        try:
            response = client.chat.completions.create(
                model=GROQ_MODEL,
                max_tokens=2048,
                temperature=0.3,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ]
            )
            return response, current_candidates

        except groq.RateLimitError as e:
            rate_limit_attempts += 1
            if rate_limit_attempts > MAX_RATE_LIMIT_RETRIES:
                console.print(f"[bold red]Rate limited after {MAX_RATE_LIMIT_RETRIES} retries, giving up: {e}[/bold red]")
                return None, current_candidates
            backoff = BASE_BACKOFF_SECONDS * (2 ** (rate_limit_attempts - 1)) + random.uniform(0, 0.5)
            console.print(f"[yellow]Rate limited, retrying in {backoff:.1f}s (attempt {rate_limit_attempts}/{MAX_RATE_LIMIT_RETRIES})...[/yellow]")
            time.sleep(backoff)

        except groq.APITimeoutError as e:
            if timeout_retried:
                console.print(f"[bold red]Request timed out again, giving up: {e}[/bold red]")
                return None, current_candidates
            timeout_retried = True
            console.print("[yellow]Request timed out, retrying once...[/yellow]")

        except groq.BadRequestError as e:
            msg = str(e).lower()
            is_context_error = any(hint in msg for hint in CONTEXT_LENGTH_HINTS)
            if is_context_error and len(current_candidates) > 1:
                reduced_count = max(1, len(current_candidates) // 2)
                console.print(
                    f"[yellow]Context length exceeded, reducing candidates from "
                    f"{len(current_candidates)} to {reduced_count} and retrying...[/yellow]"
                )
                current_candidates = current_candidates[:reduced_count]
                continue
            console.print(f"[bold red]Bad request: {e}[/bold red]")
            return None, current_candidates

        except groq.APIError as e:
            console.print(f"[bold red]Groq API Error: {e}[/bold red]")
            return None, current_candidates


def get_recommendations(candidates_df: pd.DataFrame, prefs: UserPreferences) -> Optional[LLMResponse]:
    """Call the LLM API to rank candidates and generate explanations."""
    if candidates_df.empty:
        return None

    if not GROQ_API_KEY:
        console.print("[bold red]Error: GROQ_API_KEY not found in environment.[/bold red]")
        return None

    client = Groq(api_key=GROQ_API_KEY)

    candidates_json = df_to_json_candidates(candidates_df)
    system_prompt = _build_system_prompt()

    console.print(f"[cyan]Calling {GROQ_MODEL} to rank {len(candidates_json)} candidates...[/cyan]")
    response, used_candidates = _call_groq_with_retry(client, system_prompt, candidates_json, prefs)
    if response is None:
        return None

    try:
        response_text = response.choices[0].message.content.strip()

        # Clean up in case the LLM returned markdown JSON blocks
        if response_text.startswith("```json"):
            response_text = response_text[7:]
        if response_text.startswith("```"):
            response_text = response_text[3:]
        if response_text.endswith("```"):
            response_text = response_text[:-3]

        parsed_json = _try_repair_json(response_text)
        if parsed_json is None:
            console.print("[bold red]JSON Parsing Error: could not parse or repair LLM response[/bold red]")
            console.print(f"Raw Response: {response_text}")
            return None

        # Map the recommended restaurant names back to the original DataFrame row
        # to construct the full Restaurant model
        final_recommendations = []
        for rec in parsed_json.get("recommendations", []):
            name = rec["restaurant_name"]
            # Find the row in candidates_df
            match = candidates_df[candidates_df["name"] == name]
            if not match.empty:
                row_dict = match.iloc[0].to_dict()

                # Replace NaNs with None for Pydantic validation, and normalize
                # list/array-typed fields (cuisines, popular_dishes) to plain Python
                # lists - pd.isna() on an array raises "ambiguous truth value" for
                # arrays with more than one element, so those must be checked separately.
                for k, v in row_dict.items():
                    if isinstance(v, (list, np.ndarray)):
                        row_dict[k] = list(v)
                    elif pd.isna(v):
                        row_dict[k] = None

                restaurant = Restaurant(**row_dict)

                final_recommendations.append(Recommendation(
                    rank=rec.get("rank", 0),
                    restaurant=restaurant,
                    explanation=rec.get("explanation", ""),
                    highlights=rec.get("highlights", [])
                ))

        return LLMResponse(
            recommendations=sorted(final_recommendations, key=lambda x: x.rank),
            summary=parsed_json.get("summary", "")
        )

    except Exception as e:
        console.print(f"[bold red]Unexpected Error: {e}[/bold red]")
        return None
