import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()
if "pytest" not in sys.modules:
    _root = Path(__file__).resolve().parents[2]
    for extra in (_root / "frontend" / ".env", _root / "frontend" / ".env.local"):
        if extra.exists():
            load_dotenv(extra, override=False)

XAI_API_KEY = os.getenv("XAI_API_KEY", "").strip()
XAI_MODEL = os.getenv("XAI_MODEL", "grok-4-fast")
XAI_BASE_URL = "https://api.x.ai/v1"
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./crewfit.db").strip()
AUTH0_DOMAIN = (os.getenv("AUTH0_DOMAIN") or os.getenv("VITE_AUTH0_DOMAIN") or "").strip()
AUTH0_CLIENT_ID = (os.getenv("AUTH0_CLIENT_ID") or os.getenv("VITE_AUTH0_CLIENT_ID") or "").strip()
AUTH0_AUDIENCE = os.getenv("AUTH0_AUDIENCE", AUTH0_CLIENT_ID).strip()
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,https://localhost:5173,https://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]
