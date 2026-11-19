import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# API Keys
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

# App Configuration
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
MAX_CANDIDATES = int(os.getenv("MAX_CANDIDATES", "20"))
TOP_K = int(os.getenv("TOP_K", "5"))

# Paths
BASE_DIR = Path(__file__).resolve().parent
CACHE_DIR = BASE_DIR / os.getenv("CACHE_DIR", "data/cache")

# Logging
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

# Ensure cache directory exists
CACHE_DIR.mkdir(parents=True, exist_ok=True)
