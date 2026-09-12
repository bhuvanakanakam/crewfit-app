import { useEffect, useRef, useState } from "react";
import "./app.css";
import AdminDashboard from "./components/AdminDashboard";
import ChatInterview from "./components/ChatInterview";
import CoursePicker from "./components/CoursePicker";
import MyTeam from "./components/MyTeam";
import SavedStyle from "./components/SavedStyle";
import SignIn from "./components/SignIn";
import { findMatch, listCourses, lookupProfile, submitProfile } from "./api";
import { useCrewAuth } from "./auth";
import { displayNameFromUser } from "./authConfig";
import {
  clearSession,
  consumePendingRole,
  loadProfile,
  loadSession,
  profileFor,
  saveMatch,
  saveProfile,
  saveSession,
  type Role,
  type Session,
} from "./session";
import { toCourseContext, type Course, type MatchResponse, type StructuredProfile } from "./types";

type StudentView = "intake" | "saved" | "matching" | "team";

export default function App() {
  const auth = useCrewAuth();
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [course, setCourse] = useState<Course | null>(null);
  const [courseReady, setCourseReady] = useState(() => !loadSession()?.courseId);
  const [profile, setProfile] = useState<StructuredProfile | null>(() => {
    const s = loadSession();
    return s ? profileFor(s.name) : loadProfile();
  });
  const [match, setMatch] = useState<MatchResponse | null>(null);
  const [studentView, setStudentView] = useState<StudentView>("intake");
  const [error, setError] = useState<string | null>(null);
  const signingOut = useRef(false);

  useEffect(() => {
    if (!session?.courseId) {
      setCourseReady(true);
      return;
    }
    setCourseReady(false);
    listCourses()
      .then((res) => {
        setCourse(res.courses.find((c) => c.id === session.courseId) ?? null);
      })
      .catch(() => setCourse(null))
      .finally(() => setCourseReady(true));
  }, [session?.courseId]);

  useEffect(() => {
    if (!auth.configured || auth.isLoading || signingOut.current) return;
    if (!auth.isAuthenticated || !auth.user) {
      if (!session) return;
      clearSession();
      setSession(null);
      setCourse(null);
      setMatch(null);
      return;
    }
    const name = displayNameFromUser(auth.user);
    if (session?.name === name) return;
    const existing = loadSession();
    const role = consumePendingRole() ?? existing?.role ?? session?.role ?? "student";
    const next: Session = { name, role, courseId: null };
    saveSession(next);
    setSession(next);
    setCourse(null);
    setMatch(null);
    setError(null);
    const mine = profileFor(name);
    setProfile(mine);
    setStudentView(mine ? "saved" : "intake");
  }, [auth.configured, auth.isLoading, auth.isAuthenticated, auth.user, session]);

  useEffect(() => {
    if (!session || session.role !== "student" || !course) return;
    lookupProfile(session.name, course.id)
      .then((res) => {
        if (res.profile) {
          setProfile(res.profile);
          saveProfile(res.profile);
        }
        if (res.match) {
          setMatch(res.match);
          saveMatch(session.name, course.id, res.match);
          setStudentView("team");
        } else if (res.profile || profile) {
          setMatch(null);
          setStudentView("saved");
        } else {
          setMatch(null);
          setStudentView("intake");
        }
      })
      .catch(() => {
        setStudentView(profile ? "saved" : "intake");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.name, session?.role, course?.id]);

  function signIn(name: string, role: Role) {
    const next = { name, role, courseId: null };
    setSession(next);
    saveSession(next);
    setCourse(null);
    setMatch(null);
    setError(null);
    const mine = profileFor(name);
    setProfile(mine);
    setStudentView(mine ? "saved" : "intake");
  }

  function openProfile() {
    setStudentView(profile ? "saved" : "intake");
  }

  function pickCourse(picked: Course) {
    if (!session) return;
    const next = { ...session, courseId: picked.id };
    setSession(next);
    saveSession(next);
    setCourse(picked);
    setMatch(null);
    setError(null);
  }

  function signOut() {
    signingOut.current = true;
    clearSession();
    setSession(null);
    setCourse(null);
    setMatch(null);
    setError(null);
    if (auth.configured) {
      auth.logout();
      return;
    }
    signingOut.current = false;
  }

  function changeCourse() {
    if (!session) return;
    const next = { ...session, courseId: null };
    setSession(next);
    saveSession(next);
    setCourse(null);
    setMatch(null);
    setError(null);
  }

  async function runMatch(p: StructuredProfile) {
    if (!course || !session) return;
    setProfile(p);
    saveProfile(p);
    setStudentView("matching");
    setError(null);
    try {
      await submitProfile(p, course.id).catch(() => undefined);
      const res = await findMatch(p, toCourseContext(course), course.id, 16);
      setMatch(res);
      saveMatch(session.name, course.id, res);
      setStudentView("team");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't find a team.");
      setStudentView("saved");
    }
  }

  const waitingOnAuth = auth.configured && auth.isLoading;
  const signedIn = waitingOnAuth
    ? false
    : auth.configured
      ? Boolean(auth.isAuthenticated && session)
      : Boolean(session);
  const inCourse = Boolean(session && course);

  return (
    <div className={`app-shell${signedIn ? "" : " guest"}`}>
      {signedIn && (
        <header className="app-header">
          <div className="app-header-inner">
            <span className="logo">CrewFit</span>
            {course && <span className="header-course">{course.name}</span>}
            {session?.role === "student" && course && (
              <nav className="header-nav" aria-label="Student">
                <button
                  type="button"
                  className={studentView === "intake" || studentView === "saved" ? "active" : ""}
                  onClick={openProfile}
                >
                  Chat
                </button>
                <button
                  type="button"
                  className={studentView === "team" || studentView === "matching" ? "active" : ""}
                  disabled={!match && studentView !== "matching"}
                  onClick={() => match && setStudentView("team")}
                >
                  Your team
                </button>
              </nav>
            )}
            {session && (
              <div className="header-you">
                {auth.user?.picture && (
                  <img src={auth.user.picture} alt="" className="header-avatar" referrerPolicy="no-referrer" />
                )}
                <span>
                  {session.name} · {session.role}
                </span>
                {inCourse && (
                  <button type="button" className="header-link" onClick={changeCourse}>
                    Courses
                  </button>
                )}
                <button type="button" className="header-link" onClick={signOut}>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </header>
      )}

      <main
        className={`app-main${session?.role === "teacher" && course ? " wide" : ""}${signedIn ? "" : " splash"}`}
      >
        {error && <div className="error-banner">{error}</div>}

        {!signedIn && <SignIn onSignIn={signIn} />}

        {signedIn && courseReady && !course && session && (
          <CoursePicker role={session.role} onPick={pickCourse} />
        )}

        {session?.role === "teacher" && course && (
          <>
            <p className="kicker">Teacher</p>
            <h1>{course.name}</h1>
            <p className="page-dek">
              Full student data for this course. Students only see names and group-level facts.
            </p>
            <AdminDashboard course={course} />
          </>
        )}

        {session?.role === "student" && course && studentView === "intake" && (
          <ChatInterview
            key={`${session.name}-${course.id}`}
            name={session.name}
            course={course}
            onReady={(p) => void runMatch(p)}
          />
        )}

        {session?.role === "student" && course && studentView === "saved" && profile && (
          <SavedStyle
            profile={profile}
            course={course}
            matching={false}
            hasTeam={Boolean(match)}
            onMatch={() => void runMatch(profile)}
            onViewTeam={() => match && setStudentView("team")}
            onUpdate={() => setStudentView("intake")}
          />
        )}

        {session?.role === "student" && course && studentView === "matching" && (
          <div className="matching-state">
            <p className="kicker">{course.name}</p>
            <h1>Finding your team…</h1>
            <p className="page-dek">Running the optimizer. Individual answers stay private.</p>
          </div>
        )}

        {session?.role === "student" && course && studentView === "team" && match && (
          <MyTeam
            result={match}
            yourName={session.name}
            course={course}
            profile={profile}
            onChangeCourse={changeCourse}
            onOpenChat={openProfile}
          />
        )}
      </main>
    </div>
  );
}
