"""Student intake and teacher form-teams share one official assignment."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _profile(name: str, **overrides):
    body = {
        "id": "you",
        "name": name,
        "bio": "I like shipping demos and writing the README.",
        "goal": "grade_A",
        "availability": ["mon_evening", "wed_evening", "sat_afternoon"],
        "skills": {"technical": 4, "writing": 3, "analysis": 3, "presentation": 2},
        "hours": 10,
        "role": "contributor",
        "conflict_mode": "vote",
        "confidence": 0.9,
        "clarifying_questions": [],
    }
    body.update(overrides)
    return body


def test_student_joins_chats_then_shares_teacher_teams():
    created = client.post(
        "/api/courses",
        json={
            "name": "Sync Studio",
            "actor": "Priya Chen",
            "team_size_min": 3,
            "team_size_max": 4,
        },
    )
    assert created.status_code == 200
    cid = created.json()["id"]

    joined = client.post(f"/api/courses/{cid}/enroll", json={"name": "Alex Rivera"})
    assert joined.status_code == 200

    looked = client.get("/api/profile", params={"name": "Alex Rivera", "course_id": cid})
    assert looked.status_code == 200
    assert looked.json()["profile"] is None
    assert looked.json()["match"] is None

    roster = client.get("/api/roster", params={"course_id": cid, "actor": "Priya Chen"})
    names = {p["name"] for p in roster.json()["profiles"]}
    assert "Alex Rivera" in names
    alex = next(p for p in roster.json()["profiles"] if p["name"] == "Alex Rivera")
    assert alex["id"].startswith("pending-")

    saved = client.post("/api/submit", params={"course_id": cid}, json=_profile("Alex Rivera"))
    assert saved.status_code == 200
    assert saved.json()["profile"]["id"].startswith("stu-")
    assert saved.json()["impact"] is None

    after_chat = client.get("/api/profile", params={"name": "Alex Rivera", "course_id": cid})
    assert after_chat.json()["profile"]["name"] == "Alex Rivera"
    assert after_chat.json()["match"] is None

    matched = client.post(
        "/api/match",
        json={
            "profile": saved.json()["profile"],
            "course": {
                "name": "Sync Studio",
                "grading_notes": "",
                "team_size_min": 3,
                "team_size_max": 4,
            },
            "course_id": cid,
        },
    )
    assert matched.status_code == 200
    assert matched.json()["waiting"] is False
    assert matched.json()["team"]
    student_names = {m["name"] for m in matched.json()["team"]}
    assert "Alex Rivera" in student_names

    student = client.get("/api/profile", params={"name": "Alex Rivera", "course_id": cid})
    match = student.json()["match"]
    assert match and match["waiting"] is False
    assert match["team_label"].startswith("Team ")
    assert {m["name"] for m in match["team"]} == student_names

    desk = client.get("/api/roster", params={"course_id": cid, "actor": "Priya Chen"})
    teacher_team = next(
        t for t in desk.json()["assignment"]["teams"] if any(m["name"] == "Alex Rivera" for m in t["members"])
    )
    teacher_names = {m["name"] for m in teacher_team["members"]}
    assert teacher_names == student_names

    again = client.post(
        "/api/match",
        json={
            "profile": student.json()["profile"],
            "course": {
                "name": "Sync Studio",
                "grading_notes": "",
                "team_size_min": 3,
                "team_size_max": 4,
            },
            "course_id": cid,
        },
    )
    assert {m["name"] for m in again.json()["team"]} == teacher_names
    assert again.json()["team_label"] == match["team_label"]

    updated = client.post(
        "/api/submit",
        params={"course_id": cid},
        json=_profile("Alex Rivera", hours=6, id=student.json()["profile"]["id"]),
    )
    assert updated.status_code == 200
    assert updated.json()["impact"] is not None
    after_pref = client.get("/api/profile", params={"name": "Alex Rivera", "course_id": cid})
    assert {m["name"] for m in after_pref.json()["match"]["team"]} == teacher_names
    assert after_pref.json()["match"]["team_label"] == match["team_label"]

    desk = client.get("/api/roster", params={"course_id": cid, "actor": "Priya Chen"})
    live = next(t for t in desk.json()["assignment"]["teams"] if any(m["name"] == "Alex Rivera" for m in t["members"]))
    assert {m["name"] for m in live["members"]} == teacher_names
