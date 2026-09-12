"""Login roles, TA visibility, and instructor-only actions."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_student_cannot_open_teacher_view():
    denied = client.post("/api/auth/login", json={"name": "Vamsi Rao", "requested_role": "teacher"})
    assert denied.status_code == 403
    ok = client.post("/api/auth/login", json={"name": "Vamsi Rao", "requested_role": "student"})
    assert ok.status_code == 200
    body = ok.json()
    assert body["role"] == "student"
    assert body["staff_kind"] == "none"
    assert body["can_create_course"] is True
    ids = {c["id"] for c in body["courses"]}
    assert {"hackcmu", "15112", "17214"} <= ids
    assert all(c["access"] == "student" for c in body["courses"])


def test_seeded_instructor_sees_all_courses():
    res = client.post("/api/auth/login", json={"name": "Priya Chen", "requested_role": "teacher"})
    assert res.status_code == 200
    body = res.json()
    assert body["role"] == "teacher"
    assert body["staff_kind"] == "teacher"
    assert body["can_create_course"] is True
    assert {"hackcmu", "15112", "17214"} <= {c["id"] for c in body["courses"]}
    assert all(c["access"] == "teacher" for c in body["courses"])


def test_demo_student_password_login():
    res = client.post(
        "/api/auth/login",
        json={"email": "maya.singh@squadly.edu", "password": "HackCMU-Maya-26", "requested_role": "student"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "Maya Singh"
    assert body["role"] == "student"
    assert body["staff_kind"] == "none"


def test_demo_teacher_password_login():
    res = client.post(
        "/api/auth/login",
        json={"email": "priya.chen@squadly.edu", "password": "HackCMU-Priya-26", "requested_role": "teacher"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["name"] == "Priya Chen"
    assert body["staff_kind"] == "teacher"
    bad = client.post(
        "/api/auth/login",
        json={"email": "priya.chen@squadly.edu", "password": "wrong", "requested_role": "teacher"},
    )
    assert bad.status_code == 401


def test_instructor_as_student_hides_staffed_courses():
    res = client.post("/api/auth/login", json={"name": "Priya Chen", "requested_role": "student"})
    assert res.status_code == 200
    assert res.json()["courses"] == []


def test_blank_name_rejected():
    res = client.post("/api/auth/login", json={"name": "   ", "requested_role": "student"})
    assert res.status_code == 400


def test_vamsi_google_account_is_instructor():
    res = client.post("/api/auth/login", json={"name": "Vamsi Grandhi", "requested_role": "teacher"})
    assert res.status_code == 200
    body = res.json()
    assert body["staff_kind"] == "teacher"
    assert body["can_create_course"] is True
    assert {"hackcmu", "15112", "17214"} <= {c["id"] for c in body["courses"]}


def test_token_without_name_does_not_ask_for_name():
    res = client.post("/api/auth/login", json={"id_token": "not-a-jwt", "requested_role": "student"})
    assert res.status_code in (401, 500)
    assert "Enter a name" not in res.json()["detail"]


def test_name_only_rejected_when_auth0_configured(monkeypatch):
    import app.config as cfg
    import app.main as main

    monkeypatch.setattr(cfg, "AUTH0_DOMAIN", "example.us.auth0.com")
    monkeypatch.setattr(cfg, "AUTH0_CLIENT_ID", "test-client")
    monkeypatch.setattr(cfg, "AUTH0_AUDIENCE", "test-client")
    monkeypatch.setattr(main.config, "AUTH0_DOMAIN", "example.us.auth0.com")
    denied = client.post("/api/auth/login", json={"name": "Vamsi Rao", "requested_role": "student"})
    assert denied.status_code == 401


def test_instructor_or_student_can_create_course_with_cohort():
    student = client.post(
        "/api/courses",
        json={"name": "Student Studio", "actor": "Vamsi Rao", "team_size_min": 3, "team_size_max": 4},
    )
    assert student.status_code == 200
    assert student.json()["access"] == "student"
    assert student.json()["enrolled"] is True
    created = client.post(
        "/api/courses",
        json={
            "name": "17-313 Foundations",
            "actor": "Priya Chen",
            "team_size_min": 3,
            "team_size_max": 4,
            "team_count": 5,
            "objective": "Policy memo teams that can analyze and write.",
            "focus_skills": ["analysis", "writing"],
        },
    )
    assert created.status_code == 200
    assert created.json()["access"] == "teacher"
    assert created.json()["team_count"] == 5
    assert created.json()["focus_skills"] == ["analysis", "writing"]
    assert "Policy memo" in (created.json()["objective"] or "")
    cid = created.json()["id"]
    roster = client.get("/api/roster", params={"course_id": cid, "actor": "Priya Chen"})
    assert roster.status_code == 200
    assert len(roster.json()["profiles"]) == 20
    again = client.get("/api/roster", params={"course_id": cid, "actor": "Priya Chen"})
    assert len(again.json()["profiles"]) == 20

    joined = client.post(f"/api/courses/{cid}/enroll", json={"name": "Riley Chen"})
    assert joined.status_code == 200
    after = client.get("/api/roster", params={"course_id": cid, "actor": "Priya Chen"})
    names = {p["name"] for p in after.json()["profiles"]}
    assert "Riley Chen" in names
    assert len(after.json()["profiles"]) == 21


def test_add_ta_then_login_edges():
    added = client.post(
        "/api/courses/hackcmu/staff",
        json={"actor": "Priya Chen", "name": "Jordan Lee", "kind": "ta"},
    )
    assert added.status_code == 200

    student_view = client.post("/api/auth/login", json={"name": "Jordan Lee", "requested_role": "student"})
    ids = {c["id"] for c in student_view.json()["courses"]}
    assert "hackcmu" not in ids

    teacher_view = client.post("/api/auth/login", json={"name": "Jordan Lee", "requested_role": "teacher"})
    assert teacher_view.status_code == 200
    assert [c["id"] for c in teacher_view.json()["courses"]] == ["hackcmu"]
    assert teacher_view.json()["staff_kind"] == "ta"
    assert teacher_view.json()["can_create_course"] is False
    assert all(c["access"] == "ta" for c in teacher_view.json()["courses"])
    other = client.get("/api/courses", params={"name": "Jordan Lee", "role": "teacher"})
    assert [c["id"] for c in other.json()["courses"]] == ["hackcmu"]
    blocked = client.post(
        "/api/courses",
        json={"name": "TA Should Not Create", "actor": "Jordan Lee"},
    )
    assert blocked.status_code == 403

    ta_adding = client.post(
        "/api/courses/hackcmu/staff",
        json={"actor": "Jordan Lee", "name": "Sam Patel", "kind": "ta"},
    )
    assert ta_adding.status_code == 403


def test_normalized_tables_roundtrip():
    from app.db import load_snapshot, save_snapshot

    save_snapshot(
        {
            "accounts": {
                "ada": {
                    "name": "Ada",
                    "home_role": "student",
                    "email": None,
                    "auth_sub": None,
                    "password_hash": None,
                    "created_at": "",
                }
            },
            "courses": {
                "c1": {
                    "id": "c1",
                    "name": "Demo",
                    "grading_notes": "",
                    "team_size_min": 3,
                    "team_size_max": 4,
                    "cohort_seeded": True,
                }
            },
            "staff": {"c1": {"ada": "ta"}},
            "enroll": {"c1": ["ada"]},
            "people": {},
            "matches": {},
            "concerns": {},
            "rematch_ok": {},
            "assignments": {},
            "assignment_teams": {},
            "notifications": [],
            "seq": 0,
        }
    )
    snap = load_snapshot()
    assert snap is not None
    assert snap["staff"]["c1"]["ada"] == "ta"
    assert snap["accounts"]["ada"]["name"] == "Ada"
    assert snap["enroll"]["c1"] == ["ada"]


def test_local_register_then_password_login():
    created = client.post(
        "/api/auth/register",
        json={
            "name": "Zed Signup Test",
            "email": "zed.signup.test@squadly.edu",
            "password": "Riley-Pass-26",
            "requested_role": "student",
        },
    )
    assert created.status_code == 200
    body = created.json()
    assert body["name"] == "Zed Signup Test"
    assert body["role"] == "student"
    again = client.post(
        "/api/auth/login",
        json={"email": "zed.signup.test@squadly.edu", "password": "Riley-Pass-26", "requested_role": "student"},
    )
    assert again.status_code == 200
    assert again.json()["name"] == "Zed Signup Test"
    clash = client.post(
        "/api/auth/register",
        json={
            "name": "Someone Else",
            "email": "zed.signup.test@squadly.edu",
            "password": "Riley-Pass-26",
            "requested_role": "student",
        },
    )
    assert clash.status_code == 409


def test_local_register_blocked_when_auth0_configured(monkeypatch):
    import app.config as cfg
    import app.main as main

    monkeypatch.setattr(cfg, "AUTH0_DOMAIN", "example.us.auth0.com")
    monkeypatch.setattr(main.config, "AUTH0_DOMAIN", "example.us.auth0.com")
    res = client.post(
        "/api/auth/register",
        json={
            "name": "Pat Lee",
            "email": "pat.lee@squadly.edu",
            "password": "Pat-Pass-26",
            "requested_role": "student",
        },
    )
    assert res.status_code == 401


def test_student_cannot_enroll_in_staffed_course():
    added = client.post(
        "/api/courses/15112/staff",
        json={"actor": "Priya Chen", "name": "Alex Kim", "kind": "ta"},
    )
    assert added.status_code == 200
    res = client.post("/api/courses/15112/enroll", json={"name": "Alex Kim"})
    assert res.status_code == 403
