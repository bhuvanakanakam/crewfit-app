import os
from dotenv import load_dotenv

load_dotenv()

XAI_API_KEY = os.getenv("XAI_API_KEY", "").strip()
XAI_MODEL = os.getenv("XAI_MODEL", "grok-4-fast")
XAI_BASE_URL = "https://api.x.ai/v1"
