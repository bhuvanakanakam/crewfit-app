import { useEffect, useState } from "react";
import { ChevronRight, Plus, Users } from "lucide-react";
import { createCourse, listCourses } from "../api";
import type { Course } from "../types";
import type { Role, StaffKind } from "../session";
import Chip from "./Chip";
import CourseCreateForm, { draftToCreateBody, EMPTY_COURSE_DRAFT, type CourseDraft } from "./CourseCreateForm";
import Mark from "./Mark";
import PageIntro from "./PageIntro";
import TopBar from "./TopBar";
import { Button } from "./ui/button";

interface Props {
  name: string;
  role: Role;
  staffKind?: StaffKind;
  canCreateCourse?: boolean;
  onPick: (course: Course) => void | Promise<void>;
  onSignOut: () => void;
}

export default function CoursePicker({ name, role, staffKind, canCreateCourse, onPick, onSignOut }: Props) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<CourseDraft>(EMPTY_COURSE_DRAFT);
  const [busy, setBusy] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const staff = role === "teacher";
  const canAdd = Boolean(canCreateCourse) || !staff;

  useEffect(() => {
    listCourses(name, role)
      .then((res) => setCourses(res.courses))
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load courses."));
  }, [name, role]);

  async function addCourse() {
    const body = draftToCreateBody(draft);
    if (!body.name || busy) return;
    setBusy(true);
    setError(null);
    try {
      const course = await createCourse({ ...body, actor: name });
      setCourses((prev) => [...prev, course]);
      setDraft(EMPTY_COURSE_DRAFT);
      setCreating(false);
      await onPick(course);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the course.");
    } finally {
      setBusy(false);
    }
  }

  async function joinCourse(course: Course) {
    if (joiningId) return;
    setJoiningId(course.id);
    setError(null);
    try {
      await onPick(course);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join that course.");
      setJoiningId(null);
    }
  }

  return (
    <main className="min-h-screen">
      <TopBar
        wide
        left={<Mark />}
        center={
          <div className="hidden items-center gap-1 rounded-xl bg-muted p-1.5 md:flex">
            <span className="inline-flex h-10 items-center rounded-lg bg-primary px-4 font-mono text-sm font-semibold text-primary-foreground">
              $ courses
            </span>
          </div>
        }
        right={
          <>
            <Chip tone="accent" size="sm">
              {staff ? (staffKind === "ta" ? "TA" : "Instructor") : "Student"}
            </Chip>
            <Button variant="ghost" onClick={onSignOut}>
              Sign out
            </Button>
          </>
        }
      />
      <div className={`mx-auto px-5 py-8 sm:px-8 sm:py-12 ${staff ? "max-w-[1440px]" : "max-w-[1280px]"}`}>
        <div className="flex items-end justify-between gap-4">
          <PageIntro
            kicker={staff ? "Staff access" : "Your courses"}
            title={staff ? "Choose a course" : "Enroll or add a course"}
            body={
              staff
                ? staffKind === "ta"
                  ? "You only see the course you TA. Other courses stay off this desk."
                  : "Only courses you staff appear here."
                : "Click a course to join its roster. That enrollment is saved. Or add a course — Faker fills 20 classmates the first time only."
            }
          />
          {canAdd && !creating && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Add course
            </Button>
          )}
        </div>

        {error && <p className="mt-4 rounded-xl bg-warn-soft p-3 text-sm font-semibold text-warn">{error}</p>}

        {canAdd && creating && (
          <CourseCreateForm
            draft={draft}
            onChange={setDraft}
            busy={busy}
            submitLabel={staff ? "Create course" : "Create and enroll"}
            onSubmit={() => void addCourse()}
            onCancel={() => {
              setCreating(false);
              setDraft(EMPTY_COURSE_DRAFT);
            }}
          />
        )}

        {courses.length === 0 && (
          <div className="mt-8 rounded-2xl border bg-card p-10 text-center">
            <Users className="mx-auto text-primary" />
            <p className="mt-4 font-display text-2xl font-medium tracking-[-0.03em]">{staff ? "No staffed courses yet" : "No courses yet"}</p>
            <p className="mt-2 text-muted-foreground">
              {staff
                ? staffKind === "ta"
                  ? "Ask an instructor to add you as a TA."
                  : "Add a course, or ask to be added as staff."
                : "Add a course to create a 20-person roster, or wait for an instructor to publish one."}
            </p>
          </div>
        )}

        <div className={`mt-8 grid gap-5 ${staff ? "md:grid-cols-2 xl:grid-cols-3" : "md:grid-cols-2"}`}>
          {courses.map((c) => {
            const chip =
              c.access === "ta"
                ? "TA"
                : c.access === "teacher"
                  ? "Instructor"
                  : c.enrolled
                    ? "Enrolled"
                    : "Enroll";
            const joining = joiningId === c.id;
            return (
              <Button
                key={c.id}
                variant="outline"
                className="group h-auto min-h-[160px] w-full items-stretch justify-between gap-6 whitespace-normal rounded-2xl bg-card px-8 py-7 text-left paper-shadow"
                disabled={Boolean(joiningId)}
                onClick={() => void joinCourse(c)}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex flex-wrap gap-2">
                    <Chip tone="accent">{chip}</Chip>
                    <Chip>
                      Teams of {c.team_size_min}–{c.team_size_max}
                    </Chip>
                  </span>
                  <span className="mt-5 block font-display text-2xl font-medium tracking-[-0.03em]">{c.name}</span>
                  <span className="mt-1 block text-sm font-normal text-muted-foreground">
                    {joining
                      ? "Saving you to this course…"
                      : c.enrolled
                        ? "Open this course."
                        : c.objective || c.grading_notes || "Click to join. You’ll be saved on this roster."}
                  </span>
                </span>
                <ChevronRight className="self-center text-primary transition-transform group-hover:translate-x-1" />
              </Button>
            );
          })}
        </div>

        <p className="mt-10 text-sm text-muted-foreground">
          Signed in as <span className="font-semibold text-foreground">{name}</span>
        </p>
      </div>
    </main>
  );
}
