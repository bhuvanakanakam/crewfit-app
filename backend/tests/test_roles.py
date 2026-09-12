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
    assert body["can_create_course"] is False
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


def test_ta_teacher_login_hides_other_courses():
    as_teacher = client.post("/api/auth/login", json={"name": "Alex Kim", "requested_role": "teacher"})
    assert as_teacher.status_code == 200
    body = as_teacher.json()
    assert body["staff_kind"] == "ta"
    assert body["can_create_course"] is False
    assert [c["id"] for c in body["courses"]] == ["15112"]
    assert body["courses"][0]["access"] == "ta"

    as_student = client.post("/api/auth/login", json={"name": "Alex Kim", "requested_role": "student"})
    ids = {c["id"] for c in as_student.json()["courses"]}
    assert "15112" not in ids
    assert {"hackcmu", "17214"} <= ids


def test_instructor_as_student_hides_staffed_courses():
    res = client.post("/api/auth/login", json={"name": "Priya Chen", "requested_role": "student"})
    assert res.status_code == 200
    assert res.json()["courses"] == []


def test_blank_name_rejected():
    res = client.post("/api/auth/login", json={"name": "   ", "requested_role": "student"})
    assert res.status_code == 400


def test_ta_cannot_create_course_instructor_can():
    ta = client.post(
        "/api/courses",
        json={"name": "TA Course", "actor": "Alex Kim"},
    )
    assert ta.status_code == 403
    student = client.post(
        "/api/courses",
        json={"name": "Student Course", "actor": "Vamsi Rao"},
    )
    assert student.status_code == 403
    created = client.post(
        "/api/courses",
        json={"name": "17-313 Foundations", "actor": "Priya Chen", "team_size_min": 3, "team_size_max": 4},
    )
    assert created.status_code == 200
    assert created.json()["access"] == "teacher"


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

    ta_adding = client.post(
        "/api/courses/hackcmu/staff",
        json={"actor": "Jordan Lee", "name": "Sam Patel", "kind": "ta"},
    )
    assert ta_adding.status_code == 403


def test_student_cannot_enroll_in_staffed_course():
    res = client.post("/api/courses/15112/enroll", json={"name": "Alex Kim"})
    assert res.status_code == 403
