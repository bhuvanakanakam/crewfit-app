"""Verify Auth0 ID tokens against the tenant JWKS."""

import os
from urllib.parse import urlparse

from fastapi import HTTPException
from jwt import ExpiredSignatureError, InvalidTokenError, PyJWKClient, decode

from . import config

_jwks: dict[str, PyJWKClient] = {}


def auth0_settings() -> tuple[str, str]:
    domain = (
        os.getenv("AUTH0_DOMAIN")
        or os.getenv("VITE_AUTH0_DOMAIN")
        or config.AUTH0_DOMAIN
        or ""
    ).strip()
    audience = (
        os.getenv("AUTH0_AUDIENCE")
        or os.getenv("AUTH0_CLIENT_ID")
        or os.getenv("VITE_AUTH0_CLIENT_ID")
        or config.AUTH0_AUDIENCE
        or config.AUTH0_CLIENT_ID
        or ""
    ).strip()
    return domain, audience


def _client(domain: str) -> PyJWKClient:
    if domain not in _jwks:
        _jwks[domain] = PyJWKClient(f"https://{domain}/.well-known/jwks.json", cache_keys=True)
    return _jwks[domain]


def _settings_from_token(token: str) -> tuple[str, str]:
    claims = decode(token, options={"verify_signature": False, "verify_aud": False, "verify_exp": False})
    issuer = str(claims.get("iss") or "")
    host = urlparse(issuer).netloc
    aud = claims.get("aud")
    if isinstance(aud, list):
        aud = next((item for item in aud if isinstance(item, str) and not item.startswith("https://")), aud[0] if aud else "")
    return host, str(aud or "").strip()


def verify_id_token(token: str) -> dict:
    domain, audience = auth0_settings()
    if not domain or not audience:
        try:
            token_domain, token_aud = _settings_from_token(token)
        except InvalidTokenError as exc:
            raise HTTPException(status_code=401, detail="Couldn't verify that sign-in. Use Auth0.") from exc
        domain = domain or token_domain
        audience = audience or token_aud
    if not domain or not audience:
        raise HTTPException(status_code=500, detail="Auth0 is not configured on the server.")
    try:
        key = _client(domain).get_signing_key_from_jwt(token)
        return decode(
            token,
            key.key,
            algorithms=["RS256"],
            audience=audience,
            issuer=f"https://{domain}/",
        )
    except ExpiredSignatureError as exc:
        raise HTTPException(status_code=401, detail="Your session expired. Sign in again.") from exc
    except InvalidTokenError as exc:
        raise HTTPException(status_code=401, detail="Couldn't verify that sign-in. Use Auth0.") from exc


def name_from_claims(claims: dict) -> str:
    email = str(claims.get("email") or "").strip()
    name = str(claims.get("name") or "").strip()
    if name and name.lower() != email.lower():
        return name
    given = " ".join(part for part in (claims.get("given_name"), claims.get("family_name")) if part).strip()
    if given:
        return given
    nick = str(claims.get("nickname") or "").strip()
    if nick and "@" not in nick:
        return nick
    if email and "@" in email:
        return email.split("@", 1)[0]
    return ""
