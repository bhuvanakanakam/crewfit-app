"""Durable store for Vercel + a local demo.

Local default is SQLite (`backend/crewfit.db`). For deploy, set DATABASE_URL to a
Neon/Vercel Postgres URL (`postgres://` or `postgresql://`). The React app still
belongs on Vercel; this FastAPI process should run as a long-lived service
(Railway, Render, Fly) pointed at the same database — Vercel’s filesystem is
ephemeral, so the database is the source of truth.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from .config import DATABASE_URL


def _normalize_url(url: str) -> str:
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url[len("postgres://") :]
    if url.startswith("postgresql://") and "+psycopg" not in url:
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def _url() -> str:
    if "pytest" in sys.modules:
        return "sqlite:///:memory:"
    return _normalize_url(DATABASE_URL)


_engine = create_engine(
    _url(),
    future=True,
    json_serializer=lambda o: json.dumps(o, default=str),
)
SessionLocal = sessionmaker(_engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class StateRow(Base):
    __tablename__ = "app_state"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    payload: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


def init_db() -> None:
    Base.metadata.create_all(_engine)


def load_snapshot() -> dict | None:
    init_db()
    with SessionLocal() as session:
        row = session.get(StateRow, "main")
        if row is None:
            return None
        try:
            data = json.loads(row.payload)
        except json.JSONDecodeError:
            return None
        return data if isinstance(data, dict) else None


def save_snapshot(payload: dict) -> None:
    init_db()
    blob = json.dumps(payload, default=str)
    now = datetime.now(timezone.utc)
    with SessionLocal() as session:
        row = session.get(StateRow, "main")
        if row is None:
            session.add(StateRow(id="main", payload=blob, updated_at=now))
        else:
            row.payload = blob
            row.updated_at = now
        session.commit()
