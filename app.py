import sys
import os
import argparse
import pandas as pd
from pathlib import Path

# Add project root to path
sys.path.append(str(Path(__file__).resolve().parent))

from rich.console import Console
from rich.panel import Panel
from rich.prompt import Prompt, FloatPrompt, Confirm
from rich.table import Table
from rich.markdown import Markdown

from models.schemas import UserPreferences
from data.loader import load_and_clean_data
from engine.filter import filter_restaurants
from engine.recommender import get_recommendations

console = Console()

def print_header():
    console.print(Panel.fit(
        "[bold cyan]Welcome to the Zomato AI-Powered Restaurant Recommendation System[/bold cyan]\n"
        "Tell us what you're craving, and we'll find the perfect spot!",
        border_style="cyan"
    ))

def collect_preferences() -> UserPreferences:
    console.print("\n[bold yellow]--- Your Preferences ---[/bold yellow]")
    
    location = Prompt.ask("📍 Location (e.g., Bangalore, Koramangala)", default="")
    
    cuisines_input = Prompt.ask("🍕 Cuisines (comma separated, e.g., Italian, Chinese)", default="")
    cuisines = [c.strip() for c in cuisines_input.split(",") if c.strip()] if cuisines_input else []
    
    budget = Prompt.ask("💰 Budget", choices=["low", "medium", "high", ""], default="")
    
    min_rating = FloatPrompt.ask("⭐ Minimum Rating (0.0 to 5.0)", default=0.0)
    if min_rating == 0.0:
        min_rating = None
        
    additional_notes = Prompt.ask("📝 Additional Notes/Preferences (e.g., family friendly, outdoor seating)", default="")
    
    # Create the preferences object
    prefs_dict = {
        "location": location if location else None,
        "cuisines": cuisines if cuisines else None,
        "budget": budget if budget else None,
        "min_rating": min_rating,
        "additional_notes": additional_notes if additional_notes else None
    }
    
    return UserPreferences(**prefs_dict)

def display_recommendations(llm_response):
    console.print("\n[bold green]--- Top Recommendations ---[/bold green]")
    console.print(Panel(llm_response.summary, title="Summary", border_style="green"))
    
    for rec in llm_response.recommendations:
        table = Table(show_header=False, box=None)
        table.add_column("Property", style="cyan", width=15)
        table.add_column("Value")
        
        rest = rec.restaurant
        table.add_row("Name", f"[bold]{rest.name}[/bold]")
        table.add_row("Location", rest.location)
        table.add_row("Cuisines", ", ".join(rest.cuisines) if rest.cuisines else "N/A")
        table.add_row("Cost for Two", f"₹{rest.cost_for_two}" if rest.cost_for_two else "N/A")
        table.add_row("Rating", f"⭐ {rest.rating} ({rest.votes} votes)")
        if rec.highlights:
            table.add_row("Highlights", ", ".join(rec.highlights))
            
        panel = Panel(
            table, 
            title=f"#{rec.rank} - {rest.name}", 
            border_style="blue", 
            subtitle=rec.explanation
        )
        console.print(panel)
        console.print()

def display_degraded_fallback(candidates):
    console.print()
    console.print(Panel(
        "[bold]LLM ranking is unavailable right now[/bold] (rate limit, timeout, or an unparseable response).\n"
        "Showing the top filtered results instead, sorted by rating — without personalized explanations.",
        title="⚠ Degraded Mode",
        border_style="yellow"
    ))

    table = Table(show_header=True, header_style="bold yellow")
    table.add_column("Name", style="bold")
    table.add_column("Location")
    table.add_column("Cuisines")
    table.add_column("Cost for Two")
    table.add_column("Rating")

    for _, row in candidates.head(5).iterrows():
        table.add_row(
            row["name"],
            row["location"],
            ", ".join(row["cuisines"]) if isinstance(row.get("cuisines"), list) and row["cuisines"] else "N/A",
            f"₹{row['cost_for_two']:.0f}" if pd.notna(row.get("cost_for_two")) else "N/A",
            f"⭐ {row['rating']}" if pd.notna(row.get("rating")) else "N/A"
        )
    console.print(table)

def parse_args():
    parser = argparse.ArgumentParser(description="Zomato AI-Powered Restaurant Recommendation System")
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Re-download and re-clean the dataset instead of using the local cache."
    )
    return parser.parse_args()

def main():
    args = parse_args()
    print_header()

    # Load Data
    try:
        df = load_and_clean_data(refresh=args.refresh)
        console.print(f"[green]Dataset loaded with {len(df)} restaurants.[/green]")
    except Exception as e:
        console.print(f"[bold red]Failed to load dataset: {e}[/bold red]")
        sys.exit(1)
        
    while True:
        # Collect Preferences
        prefs = collect_preferences()
        
        # Filter Data
        console.print("\n[cyan]Filtering candidates...[/cyan]")
        candidates = filter_restaurants(df, prefs)
        console.print(f"Found {len(candidates)} candidate restaurants matching (or closely matching) your criteria.")
        
        if candidates.empty:
            console.print("[yellow]No candidates found. Please try broadening your search.[/yellow]")
        else:
            # Get Recommendations
            console.print("\n[cyan]Asking the LLM for the best recommendations...[/cyan]")
            llm_response = get_recommendations(candidates, prefs)
            
            if llm_response:
                display_recommendations(llm_response)
            else:
                display_degraded_fallback(candidates)
                    
        # Ask to continue
        if not Confirm.ask("\nWould you like to search again?"):
            console.print("[bold cyan]Happy Dining! Goodbye![/bold cyan]")
            break

if __name__ == "__main__":
    main()
