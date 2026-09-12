import { useEffect, useRef, useState } from "react";
import "./app.css";
import AdminDashboard from "./components/AdminDashboard";
import ChatInterview from "./components/ChatInterview";
import CoursePicker from "./components/CoursePicker";
import MyTeam from "./components/MyTeam";
import NotifyMenu from "./components/NotifyMenu";
import PrefUpdate from "./components/PrefUpdate";
import SavedStyle from "./components/SavedStyle";
import SignIn from "./components/SignIn";
import { findMatch, enrollInCourse, listCourses, loginAccount, lookupProfile, submitProfile } from "./api";
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
import { toCourseContext, type Course, type LoginResponse, type MatchResponse, type StructuredProfile } from "./types";

type StudentView = "intake" | "saved" | "matching" | "team" | "update";

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
  const [rematchAllowed, setRematchAllowed] = useState(false);
  const [studentView, setStudentView] = useState<StudentView>(() => {
    const s = loadSession();
    const mine = s ? profileFor(s.name) : loadProfile();
    return mine ? "saved" : "intake";
  });
  const [error, setError] = useState<string | null>(null);
  const [focusStudent, setFocusStudent] = useState<string | null>(null);
  const [rosterTick, setRosterTick] = useState(0);
  const [openingCourse, setOpeningCourse] = useState(false);
  const [prefNote, setPrefNote] = useState<string | null>(null);
  const [prefHurt, setPrefHurt] = useState(false);
  const signingOut = useRef(false);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    loginAccount(session.name, session.role)
      .then((res) => {
        if (cancelled) return;
        setSession((cur) => {
          if (!cur) return cur;
          if (
            cur.name === res.name &&
            cur.role === res.role &&
            cur.staffKind === res.staff_kind &&
            cur.canCreateCourse === res.can_create_course
          ) {
            return cur;
          }
          const next = {
            ...cur,
            name: res.name,
            role: res.role,
            staffKind: res.staff_kind,
            canCreateCourse: res.can_create_course,
          };
          saveSession(next);
          return next;
        });
      })
      .catch(() => {
        if (cancelled) return;
        if (session.role !== "teacher") return;
        clearSession();
        setSession(null);
        setCourse(null);
        setError("That name isn’t staff. Sign in as a student, or ask an instructor to add you as a TA.");
      });
    return () => {
      cancelled = true;
    };
  }, [session?.name, session?.role]);

  useEffect(() => {
    if (!session?.courseId) {
      setCourseReady(true);
      return;
    }
    setCourseReady(false);
    listCourses(session.name, session.role)
      .then((res) => {
        setCourse(res.courses.find((c) => c.id === session.courseId) ?? null);
      })
      .catch(() => setCourse(null))
      .finally(() => setCourseReady(true));
  }, [session?.courseId, session?.name, session?.role]);

  useEffect(() => {
    if (!auth.configured || auth.isLoading || signingOut.current) return;
    if (!auth.isAuthenticated || !auth.user) {
      if (!session || session.local) return;
      clearSession();
      setSession(null);
      setCourse(null);
      setMatch(null);
      return;
    }
    const name = displayNameFromUser(auth.user);
    if (session?.name === name) return;
    const existing = loadSession();
    const requested = consumePendingRole() ?? existing?.role ?? session?.role ?? "student";
    void applyAuthLogin(name, requested);
  }, [auth.configured, auth.isLoading, auth.isAuthenticated, auth.user, session]);

  async function applyAuthLogin(name: string, requested: Role) {
    try {
      const res = await loginAccount(name, requested);
      applyLogin(res, false);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Couldn't sign in.";
      if (requested === "teacher") {
        try {
          const student = await loginAccount(name, "student");
          applyLogin(student, false);
          setError(message);
          return;
        } catch {
          /* keep the original error */
        }
      }
      setError(message);
    }
  }

  function applyLogin(res: LoginResponse, local: boolean) {
    const next: Session = {
      name: res.name,
      role: res.role,
      staffKind: res.staff_kind,
      canCreateCourse: res.can_create_course,
      courseId: null,
      local,
    };
    saveSession(next);
    setSession(next);
    setCourse(null);
    setMatch(null);
    setError(null);
    const mine = profileFor(res.name);
    setProfile(mine);
    setStudentView(mine ? "saved" : "intake");
  }

  function signIn(res: LoginResponse, local: boolean) {
    applyLogin(res, local);
  }

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
          setRematchAllowed(Boolean(res.rematch_allowed));
          setStudentView((cur) => (cur === "update" ? cur : "team"));
        } else if (res.profile || profile) {
          setMatch(null);
          setRematchAllowed(false);
          setStudentView((cur) => (cur === "update" ? cur : "saved"));
        } else {
          setMatch(null);
          setRematchAllowed(false);
          setStudentView("intake");
        }
      })
      .catch(() => {
        setStudentView(profile ? "saved" : "intake");
      })
      .finally(() => setOpeningCourse(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.name, session?.role, course?.id]);

  function openProfile() {
    if (match) {
      setStudentView("saved");
      return;
    }
    setStudentView(profile ? "saved" : "intake");
  }

  async function savePrefs(p: StructuredProfile) {
    if (!session) return;
    setProfile(p);
    saveProfile(p);
    setError(null);
    try {
      const res = await submitProfile(p, course?.id);
      setProfile(res.profile);
      saveProfile(res.profile);
      if (res.impact) {
        setPrefNote(res.impact.message);
        setPrefHurt(res.impact.hurts_team);
      } else {
        setPrefNote(null);
        setPrefHurt(false);
      }
    } catch {
      /* keep local copy */
    }
    setStudentView(match ? "team" : "saved");
  }

  function pickCourse(picked: Course) {
    if (!session) return;
    const next = { ...session, courseId: picked.id };
    setSession(next);
    saveSession(next);
    setCourse(picked);
    setMatch(null);
    setError(null);
    setPrefNote(null);
    setFocusStudent(null);
    if (session.role === "student") {
      setOpeningCourse(true);
      void enrollInCourse(picked.id, session.name).catch(() => undefined);
    }
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
    setFocusStudent(null);
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
      setRematchAllowed(false);
      setStudentView("team");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't find a team.");
      setStudentView("saved");
    }
  }

  const signedIn = Boolean(session) && (!auth.configured || auth.isLoading || auth.isAuthenticated);
  const inCourse = Boolean(session && course);

  return (
    <div className={`app-shell${signedIn ? "" : " guest"}`}>
      {signedIn && (
        <header className="app-header">
          <div className="app-header-inner">
            <span className="logo">CrewFit</span>
            {course && <span className="header-course">{course.name}</span>}
            {session && (
              <span className="header-chip">
                {session.staffKind === "ta" && session.role === "teacher"
                  ? "TA"
                  : session.role === "teacher"
                    ? "Instructor"
                    : "Student"}
              </span>
            )}
            {session?.role === "student" && course && (
              <nav className="header-nav" aria-label="Student">
                <button
                  type="button"
                  className={studentView === "intake" || studentView === "saved" || studentView === "update" ? "active" : ""}
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
                {course && session && (session.role === "teacher" || session.role === "student") && (
                  <NotifyMenu
                    courseId={course.id}
                    name={session.name}
                    role={session.role}
                    onOpenStudent={setFocusStudent}
                    onOpenTeam={() => setStudentView("team")}
                    onChanged={() => setRosterTick((n) => n + 1)}
                  />
                )}
                {auth.user?.picture && (
                  <img src={auth.user.picture} alt="" className="header-avatar" referrerPolicy="no-referrer" />
                )}
                <span className="header-name">{session.name}</span>
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
        {error && signedIn && <div className="error-banner">{error}</div>}

        {!signedIn && <SignIn onSignIn={signIn} banner={error} />}

        {signedIn && !courseReady && <p className="page-dek">Loading…</p>}

        {signedIn && courseReady && !course && session && (
          <CoursePicker
            name={session.name}
            role={session.role}
            staffKind={session.staffKind}
            canCreateCourse={session.canCreateCourse}
            onPick={pickCourse}
          />
        )}

        {signedIn && session?.role === "teacher" && course && (
          <AdminDashboard
            course={course}
            actor={session.name}
            canManageStaff={course.access === "teacher"}
            focusName={focusStudent}
            reloadToken={rosterTick}
          />
        )}

        {signedIn && session?.role === "student" && course && openingCourse && (
          <p className="page-dek">Opening course…</p>
        )}

        {signedIn && session?.role === "student" && course && !openingCourse && studentView === "intake" && !(match && !rematchAllowed) && (
          <ChatInterview
            key={`${session.name}-${course.id}`}
            name={session.name}
            course={course}
            onReady={(p) => void runMatch(p)}
          />
        )}

        {signedIn && session?.role === "student" && course && !openingCourse && studentView === "intake" && match && !rematchAllowed && profile && (
          <SavedStyle
            profile={profile}
            course={course}
            matching={false}
            hasTeam
            rematchAllowed={false}
            team={match}
            onMatch={() => undefined}
            onViewTeam={() => setStudentView("team")}
            onUpdate={() => setStudentView("update")}
          />
        )}

        {signedIn && session?.role === "student" && course && !openingCourse && studentView === "saved" && profile && (
          <SavedStyle
            profile={profile}
            course={course}
            matching={false}
            hasTeam={Boolean(match)}
            rematchAllowed={rematchAllowed}
            team={match}
            onMatch={() => void runMatch(profile)}
            onViewTeam={() => match && setStudentView("team")}
            onUpdate={() => setStudentView("update")}
            onRematch={() => void runMatch(profile)}
          />
        )}

        {signedIn && session?.role === "student" && course && !openingCourse && studentView === "update" && profile && (
          <PrefUpdate
            name={session.name}
            course={course}
            profile={profile}
            onSave={(p) => void savePrefs(p)}
            onCancel={() => setStudentView(match ? "team" : "saved")}
          />
        )}

        {signedIn && session?.role === "student" && course && studentView === "matching" && (
          <div className="matching-state">
            <span className="pulse" aria-hidden />
            <h1>Finding your team…</h1>
            <p className="page-dek">Matching hours, goals, and skills for {course.name}.</p>
          </div>
        )}

        {signedIn && session?.role === "student" && course && !openingCourse && studentView === "team" && match && (
          <MyTeam
            result={match}
            yourName={session.name}
            course={course}
            profile={profile}
            rematchAllowed={rematchAllowed}
            impactNote={prefNote}
            impactHurt={prefHurt}
            onChangeCourse={changeCourse}
            onUpdatePrefs={() => setStudentView("update")}
            onRematch={profile ? () => void runMatch(profile) : undefined}
          />
        )}
      </main>
    </div>
  );
}
