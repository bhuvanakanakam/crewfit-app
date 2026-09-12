import os
from pathlib import Path

from dotenv import load_dotenv

from .crypto_secret import decrypt_secret

_BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(_BACKEND_DIR / ".env.shared")
load_dotenv(_BACKEND_DIR / ".env", override=True)


def _xai_api_key() -> str:
    encrypted = os.getenv("XAI_API_KEY_ENCRYPTED", "").strip()
    if encrypted:
        return decrypt_secret(encrypted)
    return os.getenv("XAI_API_KEY", "").strip()


XAI_API_KEY = _xai_api_key()
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
