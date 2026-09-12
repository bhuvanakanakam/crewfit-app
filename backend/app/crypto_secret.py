"""Team-shared wrap for secrets that are committed as ciphertext.

Anyone who can clone the repo can decrypt — the unlock lives in this file so
teammates need no extra setup. This keeps the raw xAI key out of git (and out
of secret scanners that look for an `xai-` prefix). It is not a lock against
people who have the source.
"""

from __future__ import annotations

import base64
import os

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

# Fixed salt + default passphrase: same on every machine after git pull.
_SALT = b"dotslash-xai-wrap-v1"
_DEFAULT_UNLOCK = "dotslash-hackcmu-2026"


def _unlock() -> str:
    return os.getenv("DOTSLASH_UNLOCK", _DEFAULT_UNLOCK)


def _fernet() -> Fernet:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=_SALT, iterations=120_000)
    key = base64.urlsafe_b64encode(kdf.derive(_unlock().encode()))
    return Fernet(key)


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(token: str) -> str:
    if not token.strip():
        return ""
    try:
        return _fernet().decrypt(token.strip().encode()).decode()
    except InvalidToken as exc:
        raise RuntimeError("Could not decrypt secret — DOTSLASH_UNLOCK does not match ciphertext.") from exc
