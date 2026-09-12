import { useEffect, useRef, useState } from "react";
import "./styles.css";
import AdminDashboard from "./components/AdminDashboard";
import AppHeader from "./components/AppHeader";
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
import {
  hasOfficialTeam,
  isPendingProfile,
  toCourseContext,
  type Course,
  type LoginResponse,
  type MatchResponse,
  type StructuredProfile,
} from "./types";

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
    return mine && !isPendingProfile(mine) ? "saved" : "intake";
  });
  const [error, setError] = useState<string | null>(null);
  const [focusStudent, setFocusStudent] = useState<string | null>(null);
  const [rosterTick, setRosterTick] = useState(0);
  const [openingCourse, setOpeningCourse] = useState(false);
  const [prefNote, setPrefNote] = useState<string | null>(null);
  const [prefHurt, setPrefHurt] = useState(false);
  const [deskTab, setDeskTab] = useState<"students" | "teams">("students");
  const signingOut = useRef(false);

  useEffect(() => {
    if (!session || session.demo) return;
    if (!auth.configured || auth.isLoading || !auth.isAuthenticated) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await auth.getIdToken();
        if (!token || cancelled) return;
        const res = await loginAccount({ id_token: token, requested_role: session.role });
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
      } catch {
        if (cancelled) return;
        if (session.role !== "teacher") return;
        clearSession();
        setSession(null);
        setCourse(null);
        setError("You’re not listed as course staff. Sign in as a student, or ask an instructor to add you as a TA.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.name, session?.role, auth.configured, auth.isAuthenticated, auth.isLoading]);

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
      if (!session || session.demo) return;
      clearSession();
      setSession(null);
      setCourse(null);
      setMatch(null);
      return;
    }
    const authName = displayNameFromUser(auth.user);
    if (session && (session.name === authName || session.name === auth.user.name)) return;
    const requested = consumePendingRole() ?? session?.role ?? loadSession()?.role ?? "student";
    void applyAuthLogin(requested);
  }, [auth.configured, auth.isLoading, auth.isAuthenticated, auth.user, session]);

  async function applyAuthLogin(requested: Role) {
    try {
      const token = await auth.getIdToken();
      if (!token) throw new Error("Auth0 did not return a token.");
      const res = await loginAccount({ id_token: token, requested_role: requested });
      applyLogin(res);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Couldn't sign in.";
      if (requested === "teacher") {
        try {
          const token = await auth.getIdToken();
          if (!token) throw new Error(message);
          const student = await loginAccount({ id_token: token, requested_role: "student" });
          applyLogin(student);
          setError(message);
          return;
        } catch {
          /* keep the original error */
        }
      }
      setError(message);
    }
  }

  function applyLogin(res: LoginResponse, demo = false) {
    const next: Session = {
      name: res.name,
      role: res.role,
      staffKind: res.staff_kind,
      canCreateCourse: res.can_create_course,
      courseId: null,
      demo,
    };
    saveSession(next);
    setSession(next);
    setCourse(null);
    setMatch(null);
    setError(null);
    const mine = profileFor(res.name);
    setProfile(mine);
    setStudentView(mine && !isPendingProfile(mine) ? "saved" : "intake");
  }

  useEffect(() => {
    if (!session || session.role !== "student" || !course) return;
    lookupProfile(session.name, course.id)
      .then((res) => {
        if (res.profile && !isPendingProfile(res.profile)) {
          setProfile(res.profile);
          saveProfile(res.profile);
        } else if (!res.profile) {
          setProfile((cur) => (cur && !isPendingProfile(cur) ? cur : null));
        }
        if (res.match && hasOfficialTeam(res.match)) {
          setMatch(res.match);
          saveMatch(session.name, course.id, res.match);
          setRematchAllowed(Boolean(res.rematch_allowed));
          setStudentView((cur) => (cur === "update" ? cur : "team"));
        } else if (res.profile && !isPendingProfile(res.profile)) {
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
    if (profile && !isPendingProfile(profile)) {
      setStudentView("saved");
      return;
    }
    setStudentView("intake");
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
      if (course) {
        const looked = await lookupProfile(session.name, course.id);
        if (looked.profile && !isPendingProfile(looked.profile)) {
          setProfile(looked.profile);
          saveProfile(looked.profile);
        }
        if (looked.match && hasOfficialTeam(looked.match)) {
          setMatch(looked.match);
          saveMatch(session.name, course.id, looked.match);
        }
      }
    } catch {
      /* keep local copy */
    }
    setStudentView(hasOfficialTeam(match) ? "team" : "saved");
  }

  async function pickCourse(picked: Course) {
    if (!session) return;
    if (session.role === "student") {
      setOpeningCourse(true);
      try {
        await enrollInCourse(picked.id, session.name);
      } catch (e) {
        setOpeningCourse(false);
        setError(e instanceof Error ? e.message : "Couldn't enroll in that course.");
        return;
      }
    }
    const next = { ...session, courseId: picked.id };
    setSession(next);
    saveSession(next);
    setCourse(picked);
    setMatch(null);
    setError(null);
    setPrefNote(null);
    setFocusStudent(null);
  }

  function signOut() {
    signingOut.current = true;
    clearSession();
    setSession(null);
    setCourse(null);
    setMatch(null);
    setError(null);
    if (auth.configured && !session?.demo) {
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
      const saved = await submitProfile(p, course.id).catch(() => undefined);
      if (saved?.profile) {
        setProfile(saved.profile);
        saveProfile(saved.profile);
      }
      const res = await findMatch(saved?.profile ?? p, toCourseContext(course), course.id, 20);
      setMatch(res);
      saveMatch(session.name, course.id, res);
      setRematchAllowed(false);
      setStudentView(hasOfficialTeam(res) ? "team" : "saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't find a team.");
      setStudentView("saved");
    }
  }

  const signedIn =
    Boolean(session) &&
    (Boolean(session?.demo) || (auth.configured && (auth.isLoading || auth.isAuthenticated)));
  const staff = session?.role === "teacher";
  const roleLabel =
    session?.staffKind === "ta" && session.role === "teacher"
      ? "TA"
      : session?.role === "teacher"
        ? "Instructor"
        : "Student";

  return (
    <div className="relative min-h-screen bg-background">
      {signedIn && course && session && (
        <AppHeader
          staff={staff}
          wide
          courseName={course.name}
          roleLabel={roleLabel}
          userName={session.name}
          deskTab={deskTab}
          studentView={studentView}
          hasTeam={hasOfficialTeam(match)}
          onDeskTab={setDeskTab}
          onOpenProfile={openProfile}
          onOpenTeam={() => hasOfficialTeam(match) && setStudentView("team")}
          onChangeCourse={changeCourse}
          onSignOut={signOut}
          notify={
            <NotifyMenu
              courseId={course.id}
              name={session.name}
              role={session.role}
              onOpenStudent={(who) => {
                setFocusStudent(who);
                setDeskTab("students");
              }}
              onOpenTeam={() => setStudentView("team")}
              onChanged={() => setRosterTick((n) => n + 1)}
            />
          }
        />
      )}

      {!signedIn && <SignIn onSignIn={applyLogin} banner={error} />}

      {signedIn && !courseReady && <p className="px-6 py-16 text-muted-foreground">Loading…</p>}

      {signedIn && courseReady && !course && session && (
        <CoursePicker
          name={session.name}
          role={session.role}
          staffKind={session.staffKind}
          canCreateCourse={session.canCreateCourse}
          onPick={pickCourse}
          onSignOut={signOut}
        />
      )}

      {signedIn && course && (
        <main className={`mx-auto px-5 py-9 sm:px-8 sm:py-12 ${staff ? "max-w-[1440px]" : studentView === "team" ? "max-w-[1120px]" : "max-w-[920px]"}`}>
          {error && <p className="mb-5 rounded-xl bg-warn-soft p-3 text-sm font-semibold text-warn">{error}</p>}

          {session?.role === "teacher" && (
            <AdminDashboard
              course={course}
              actor={session.name}
              canManageStaff={course.access === "teacher"}
              focusName={focusStudent}
              reloadToken={rosterTick}
              deskTab={deskTab}
            />
          )}

          {session?.role === "student" && openingCourse && <p className="text-muted-foreground">Opening course…</p>}

          {session?.role === "student" && !openingCourse && studentView === "intake" && !hasOfficialTeam(match) && (
            <ChatInterview
              key={`${session.name}-${course.id}`}
              name={session.name}
              course={course}
              onReady={(p) => void runMatch(p)}
            />
          )}

          {session?.role === "student" && !openingCourse && studentView === "saved" && profile && !isPendingProfile(profile) && (
            <SavedStyle
              profile={profile}
              course={course}
              matching={false}
              hasTeam={hasOfficialTeam(match)}
              rematchAllowed={rematchAllowed}
              team={match}
              onMatch={() => void runMatch(profile)}
              onViewTeam={() => hasOfficialTeam(match) && setStudentView("team")}
              onUpdate={() => setStudentView("update")}
              onRematch={() => void runMatch(profile)}
            />
          )}

          {session?.role === "student" && !openingCourse && studentView === "update" && profile && (
            <PrefUpdate
              name={session.name}
              course={course}
              profile={profile}
              onSave={(p) => void savePrefs(p)}
              onCancel={() => setStudentView(hasOfficialTeam(match) ? "team" : "saved")}
            />
          )}

          {session?.role === "student" && studentView === "matching" && (
            <div className="flex min-h-[65vh] flex-col items-center justify-center text-center">
              <span className="crew-pulse mb-7 size-5 rounded-full bg-primary" aria-hidden />
              <h1 className="font-mono text-3xl font-semibold tracking-[-0.04em]">Finding your team…</h1>
              <p className="mt-3 text-muted-foreground">Balancing goals, time, skills, and working rhythm.</p>
            </div>
          )}

          {session?.role === "student" && !openingCourse && studentView === "team" && hasOfficialTeam(match) && match && (
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
      )}

    </div>
  );
}
