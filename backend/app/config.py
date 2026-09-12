import os
from dotenv import load_dotenv

load_dotenv()

XAI_API_KEY = os.getenv("XAI_API_KEY", "").strip()
XAI_MODEL = os.getenv("XAI_MODEL", "grok-4-fast")
XAI_BASE_URL = "https://api.x.ai/v1"
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./crewfit.db").strip()
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,https://localhost:5173,https://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]
