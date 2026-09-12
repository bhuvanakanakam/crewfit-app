"""Durable store for Vercel + a local demo.

Local default is SQLite (`backend/crewfit.db`). Open that file to browse
real tables: accounts, courses, staff, enrollments, profiles.

For deploy, set DATABASE_URL to a Neon/Vercel Postgres URL. The React app
still belongs on Vercel; this FastAPI process should run as a long-lived
service pointed at the same database.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text, create_engine, delete, select
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


class AccountRow(Base):
    __tablename__ = "accounts"
    name_key: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str] = mapped_column(String(256))
    home_role: Mapped[str] = mapped_column(String(32))
    email: Mapped[str | None] = mapped_column(String(256), nullable=True)
    auth_sub: Mapped[str | None] = mapped_column(String(256), nullable=True)
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(String(64), default="")


class CourseRow(Base):
    __tablename__ = "courses"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(256))
    grading_notes: Mapped[str] = mapped_column(Text, default="")
    team_size_min: Mapped[int] = mapped_column(Integer, default=3)
    team_size_max: Mapped[int] = mapped_column(Integer, default=4)
    team_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    objective: Mapped[str] = mapped_column(Text, default="")
    focus_skills: Mapped[str] = mapped_column(Text, default="")
    skill_labels: Mapped[str] = mapped_column(Text, default="")
    cohort_seeded: Mapped[bool] = mapped_column(Boolean, default=False)


class StaffRow(Base):
    __tablename__ = "staff"
    course_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name_key: Mapped[str] = mapped_column(String(128), primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))


class EnrollmentRow(Base):
    __tablename__ = "enrollments"
    course_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name_key: Mapped[str] = mapped_column(String(128), primary_key=True)


class ProfileRow(Base):
    __tablename__ = "profiles"
    name_key: Mapped[str] = mapped_column(String(128), primary_key=True)
    payload: Mapped[str] = mapped_column(Text)


class JsonRow(Base):
    __tablename__ = "json_bags"
    bag: Mapped[str] = mapped_column(String(32), primary_key=True)
    item_key: Mapped[str] = mapped_column(String(256), primary_key=True)
    payload: Mapped[str] = mapped_column(Text)


def init_db() -> None:
    Base.metadata.create_all(_engine)
    _ensure_course_columns()


def _ensure_course_columns() -> None:
    statements = (
        "ALTER TABLE courses ADD COLUMN team_count INTEGER",
        "ALTER TABLE courses ADD COLUMN objective TEXT DEFAULT ''",
        "ALTER TABLE courses ADD COLUMN focus_skills TEXT DEFAULT ''",
        "ALTER TABLE courses ADD COLUMN skill_labels TEXT DEFAULT ''",
    )
    with _engine.begin() as conn:
        for sql in statements:
            try:
                conn.exec_driver_sql(sql)
            except Exception:
                continue


def _write_tables(session, payload: dict) -> None:
    session.execute(delete(AccountRow))
    session.execute(delete(CourseRow))
    session.execute(delete(StaffRow))
    session.execute(delete(EnrollmentRow))
    session.execute(delete(ProfileRow))
    session.execute(delete(JsonRow))

    for key, raw in (payload.get("accounts") or {}).items():
        session.add(
            AccountRow(
                name_key=str(key),
                name=str(raw.get("name") or key),
                home_role=str(raw.get("home_role") or "student"),
                email=raw.get("email"),
                auth_sub=raw.get("auth_sub"),
                password_hash=raw.get("password_hash"),
                created_at=str(raw.get("created_at") or ""),
            )
        )
    for key, raw in (payload.get("courses") or {}).items():
        session.add(
            CourseRow(
                id=str(raw.get("id") or key),
                name=str(raw.get("name") or key),
                grading_notes=str(raw.get("grading_notes") or ""),
                team_size_min=int(raw.get("team_size_min") or 3),
                team_size_max=int(raw.get("team_size_max") or 4),
                team_count=raw.get("team_count"),
                objective=str(raw.get("objective") or raw.get("grading_notes") or ""),
                focus_skills=json.dumps(raw.get("focus_skills") or []),
                skill_labels=json.dumps(raw.get("skill_labels") or {}),
                cohort_seeded=bool(raw.get("cohort_seeded")),
            )
        )
    for cid, members in (payload.get("staff") or {}).items():
        for name_key, kind in dict(members).items():
            session.add(StaffRow(course_id=str(cid), name_key=str(name_key), kind=str(kind)))
    for cid, names in (payload.get("enroll") or {}).items():
        for name_key in names:
            session.add(EnrollmentRow(course_id=str(cid), name_key=str(name_key)))
    for key, raw in (payload.get("people") or {}).items():
        session.add(ProfileRow(name_key=str(key), payload=json.dumps(raw, default=str)))

    bags = {
        "matches": payload.get("matches") or {},
        "concerns": payload.get("concerns") or {},
        "rematch_ok": payload.get("rematch_ok") or {},
        "assignments": payload.get("assignments") or {},
        "assignment_teams": payload.get("assignment_teams") or {},
        "meta": {"seq": payload.get("seq", 0)},
    }
    for bag, items in bags.items():
        if bag == "meta":
            session.add(JsonRow(bag=bag, item_key="seq", payload=json.dumps(items.get("seq", 0))))
            continue
        for item_key, raw in dict(items).items():
            session.add(JsonRow(bag=bag, item_key=str(item_key), payload=json.dumps(raw, default=str)))
    for rec in payload.get("notifications") or []:
        session.add(
            JsonRow(
                bag="notifications",
                item_key=str(rec.get("id") or ""),
                payload=json.dumps(rec, default=str),
            )
        )


def _read_tables(session) -> dict | None:
    courses = session.execute(select(CourseRow)).scalars().all()
    accounts = session.execute(select(AccountRow)).scalars().all()
    if not courses and not accounts:
        return None
    people = {}
    for row in session.execute(select(ProfileRow)).scalars():
        people[row.name_key] = json.loads(row.payload)
    staff: dict[str, dict[str, str]] = {}
    for row in session.execute(select(StaffRow)).scalars():
        staff.setdefault(row.course_id, {})[row.name_key] = row.kind
    enroll: dict[str, list[str]] = {}
    for row in session.execute(select(EnrollmentRow)).scalars():
        enroll.setdefault(row.course_id, []).append(row.name_key)
    bags: dict[str, dict] = {name: {} for name in ("matches", "concerns", "rematch_ok", "assignments", "assignment_teams")}
    notifications = []
    seq = 0
    for row in session.execute(select(JsonRow)).scalars():
        if row.bag == "notifications":
            notifications.append(json.loads(row.payload))
            continue
        if row.bag == "meta" and row.item_key == "seq":
            seq = int(json.loads(row.payload))
            continue
        if row.bag in bags:
            bags[row.bag][row.item_key] = json.loads(row.payload)
    return {
        "people": people,
        "courses": {
            row.id: {
                "id": row.id,
                "name": row.name,
                "grading_notes": row.grading_notes,
                "team_size_min": row.team_size_min,
                "team_size_max": row.team_size_max,
                "team_count": row.team_count,
                "objective": getattr(row, "objective", "") or "",
                "focus_skills": json.loads(getattr(row, "focus_skills", "") or "[]")
                if getattr(row, "focus_skills", "")
                else [],
                "skill_labels": json.loads(getattr(row, "skill_labels", "") or "{}")
                if getattr(row, "skill_labels", "")
                else {},
                "cohort_seeded": row.cohort_seeded,
            }
            for row in courses
        },
        "enroll": enroll,
        "matches": bags["matches"],
        "concerns": bags["concerns"],
        "rematch_ok": bags["rematch_ok"],
        "assignments": bags["assignments"],
        "assignment_teams": bags["assignment_teams"],
        "notifications": notifications,
        "accounts": {
            row.name_key: {
                "name": row.name,
                "home_role": row.home_role,
                "email": row.email,
                "auth_sub": row.auth_sub,
                "password_hash": row.password_hash,
                "created_at": row.created_at,
            }
            for row in accounts
        },
        "staff": staff,
        "seq": seq,
    }


def load_snapshot() -> dict | None:
    init_db()
    with SessionLocal() as session:
        tabled = _read_tables(session)
        if tabled:
            return tabled
        row = session.get(StateRow, "main")
        if row is None:
            return None
        try:
            data = json.loads(row.payload)
        except json.JSONDecodeError:
            return None
        if not isinstance(data, dict):
            return None
        _write_tables(session, data)
        session.commit()
        return data


def save_snapshot(payload: dict) -> None:
    init_db()
    blob = json.dumps(payload, default=str)
    now = datetime.now(timezone.utc)
    with SessionLocal() as session:
        _write_tables(session, payload)
        row = session.get(StateRow, "main")
        if row is None:
            session.add(StateRow(id="main", payload=blob, updated_at=now))
        else:
            row.payload = blob
            row.updated_at = now
        session.commit()
