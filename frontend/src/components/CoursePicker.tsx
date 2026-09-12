import { useEffect, useState } from "react";
import { createCourse, listCourses } from "../api";
import type { Course } from "../types";
import type { Role } from "../session";

interface Props {
  role: Role;
  onPick: (course: Course) => void;
}

export default function CoursePicker({ role, onPick }: Props) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listCourses()
      .then((res) => setCourses(res.courses))
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load courses."));
  }, []);

  async function addCourse() {
    const title = name.trim();
    if (!title || busy) return;
    setBusy(true);
    setError(null);
    try {
      const course = await createCourse({ name: title, grading_notes: notes.trim() });
      setCourses((prev) => [...prev, course]);
      onPick(course);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the course.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="course-picker">
      <p className="kicker">Course</p>
      <h1>Pick a course</h1>
      <p className="page-dek">
        {role === "student"
          ? "Pick a course, then chat with CrewFit to build your working-style profile before we form a team."
          : "Open a course to see enrolled students. They build profiles in the student chat."}
      </p>

      {error && <div className="error-banner">{error}</div>}

      <div className="course-list">
        {courses.map((c) => (
          <button type="button" className="course-card" key={c.id} onClick={() => onPick(c)}>
            <strong>{c.name}</strong>
            <span>
              Teams of {c.team_size_min}–{c.team_size_max}
              {c.grading_notes ? ` · ${c.grading_notes}` : ""}
            </span>
          </button>
        ))}
      </div>

      {role === "teacher" && !creating && (
        <button className="btn ghost" type="button" onClick={() => setCreating(true)}>
          New course
        </button>
      )}

      {role === "teacher" && creating && (
        <div className="new-course">
          <label htmlFor="course-name">Course name</label>
          <input
            id="course-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 15-213 Intro to Computer Systems"
          />
          <label htmlFor="course-notes">Notes (optional)</label>
          <input
            id="course-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Team size, project, grading"
          />
          <div className="form-actions">
            <button className="btn primary" type="button" disabled={!name.trim() || busy} onClick={() => void addCourse()}>
              {busy ? "Creating…" : "Create and open"}
            </button>
            <button className="btn ghost" type="button" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
