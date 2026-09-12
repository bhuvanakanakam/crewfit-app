import { useEffect, useState } from "react";
import { createCourse, listCourses } from "../api";
import type { Course } from "../types";
import type { Role, StaffKind } from "../session";

interface Props {
  name: string;
  role: Role;
  staffKind?: StaffKind;
  canCreateCourse?: boolean;
  onPick: (course: Course) => void;
}

export default function CoursePicker({ name, role, staffKind, canCreateCourse, onPick }: Props) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [courseName, setCourseName] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listCourses(name, role)
      .then((res) => setCourses(res.courses))
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load courses."));
  }, [name, role]);

  async function addCourse() {
    const title = courseName.trim();
    if (!title || busy) return;
    setBusy(true);
    setError(null);
    try {
      const course = await createCourse({ name: title, grading_notes: notes.trim(), actor: name });
      setCourses((prev) => [...prev, course]);
      onPick(course);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the course.");
    } finally {
      setBusy(false);
    }
  }

  const staff = role === "teacher";
  const dek = staff
    ? staffKind === "ta"
      ? "Only the courses you TA. Everything else stays on your student sign-in."
      : "Open a course to see the roster, flags, and live matching."
    : "Pick a course. We’ll form a team from your working style.";

  return (
    <div className="course-picker">
      <div className="page-head">
        <p className="kicker">{staff ? (staffKind === "ta" ? "Teaching assistant" : "Instructor") : "Student"}</p>
        <h1>{staff ? "Your courses" : "Pick a course"}</h1>
        <p className="page-dek">{dek}</p>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {courses.length === 0 && (
        <div className="empty-card">
          <h3>{staff ? "No courses on this view" : "No courses yet"}</h3>
          <p>
            {staff
              ? staffKind === "ta"
                ? "You aren’t assigned as TA on any course. Sign in as a student for classes you’re taking."
                : "Create a course, or ask to be added as staff."
              : "Ask your instructor to publish a course."}
          </p>
        </div>
      )}

      <div className="course-list">
        {courses.map((c) => (
          <button type="button" className="course-card" key={c.id} onClick={() => onPick(c)}>
            <span className="course-card-top">
              <strong>{c.name}</strong>
              {c.access === "ta" && <span className="chip">TA</span>}
              {c.access === "teacher" && <span className="chip">Instructor</span>}
              {c.enrolled && <span className="chip quiet">Enrolled</span>}
            </span>
            <span>
              Teams of {c.team_size_min}–{c.team_size_max}
              {c.grading_notes ? ` · ${c.grading_notes}` : ""}
            </span>
          </button>
        ))}
      </div>

      {canCreateCourse && !creating && (
        <button className="btn ghost" type="button" onClick={() => setCreating(true)}>
          New course
        </button>
      )}

      {canCreateCourse && creating && (
        <div className="new-course">
          <label htmlFor="course-name">Course name</label>
          <input
            id="course-name"
            value={courseName}
            onChange={(e) => setCourseName(e.target.value)}
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
            <button className="btn primary" type="button" disabled={!courseName.trim() || busy} onClick={() => void addCourse()}>
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
