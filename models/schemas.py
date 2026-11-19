from typing import List, Optional, Literal
from pydantic import BaseModel, Field

class UserPreferences(BaseModel):
    location: Optional[str] = None
    cuisines: Optional[List[str]] = None
    budget: Optional[Literal["low", "medium", "high"]] = None
    min_rating: Optional[float] = Field(None, ge=0.0, le=5.0)
    restaurant_type: Optional[str] = None
    online_order: Optional[bool] = None
    book_table: Optional[bool] = None
    additional_notes: Optional[str] = None

class Restaurant(BaseModel):
    name: str
    url: Optional[str] = None
    address: Optional[str] = None
    location: str
    city: Optional[str] = None
    cuisines: List[str]
    cost_for_two: Optional[int] = None
    rating: Optional[float] = Field(None, ge=0.0, le=5.0)
    votes: int = 0
    online_order: bool = False
    book_table: bool = False
    restaurant_type: Optional[str] = None
    popular_dishes: Optional[List[str]] = None
    phone: Optional[str] = None

class Recommendation(BaseModel):
    rank: int
    restaurant: Restaurant
    explanation: str
    highlights: Optional[List[str]] = None

class LLMResponse(BaseModel):
    recommendations: List[Recommendation]
    summary: str
