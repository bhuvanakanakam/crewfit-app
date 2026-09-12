import { useState } from "react";
import "./app.css";
import CourseSetup from "./components/CourseSetup";
import RosterInput from "./components/RosterInput";
import ProfileReview from "./components/ProfileReview";
import TeamResultsView from "./components/TeamResults";
import { clarifyProfiles, flagTeammate, optimizeTeams, parseProfiles } from "./api";
import type { CourseContext, FlagReason, OptimizeResponse, PersonInput, StructuredProfile } from "./types";

type Stage = "course" | "roster" | "profiles" | "results";

const DEFAULT_COURSE: CourseContext = {
  name: "",
  grading_notes: "",
  team_size_min: 3,
  team_size_max: 4,
};

export default function App() {
  const [stage, setStage] = useState<Stage>("course");
  const [course, setCourse] = useState<CourseContext>(DEFAULT_COURSE);
  const [people, setPeople] = useState<PersonInput[]>([]);
  const [profiles, setProfiles] = useState<StructuredProfile[]>([]);
  const [results, setResults] = useState<OptimizeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleParse() {
    setLoading(true);
    setError(null);
    try {
      const res = await parseProfiles(course, people);
      setProfiles(res.profiles);
      setStage("profiles");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong parsing the roster.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResolveClarifications(profileId: string, answers: { question: string; answer: string }[]) {
    setError(null);
    try {
      const res = await clarifyProfiles(
        course,
        profiles,
        answers.map((a) => ({ profile_id: profileId, question: a.question, answer: a.answer }))
      );
      setProfiles(res.profiles);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't resolve that clarification.");
    }
  }

  async function handleOptimize() {
    setLoading(true);
    setError(null);
    try {
      const res = await optimizeTeams(course, profiles);
      setResults(res);
      setStage("results");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The solver couldn't find a feasible assignment.");
    } finally {
      setLoading(false);
    }
  }

  async function handleFlag(personId: string, reason: FlagReason) {
    if (!results) return;
    setError(null);
    try {
      const res = await flagTeammate(course, profiles, results.teams, personId, reason);
      setResults(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't re-optimize around that flag.");
    }
  }

  const stageOrder: Stage[] = ["course", "roster", "profiles", "results"];
  const stageLabel: Record<Stage, string> = {
    course: "1 · Course",
    roster: "2 · Roster",
    profiles: "3 · Profiles",
    results: "4 · Teams",
  };

  return (
    <div className="page">
      <header className="topbar">
        <div>
          <div className="brand">
            <h1>
              Crew<span className="mark">Fit</span>
            </h1>
          </div>
          <p className="tagline">Constraint-based team formation for a cohort, not a coin flip.</p>
        </div>
        <ol className="stages">
          {stageOrder.map((s, i) => (
            <li
              key={s}
              className={s === stage ? "active" : stageOrder.indexOf(stage) > i ? "done" : ""}
            >
              {stageLabel[s]}
            </li>
          ))}
        </ol>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {stage === "course" && (
        <CourseSetup course={course} onChange={setCourse} onContinue={() => setStage("roster")} />
      )}

      {stage === "roster" && (
        <RosterInput
          people={people}
          onChange={setPeople}
          onBack={() => setStage("course")}
          onSubmit={handleParse}
          loading={loading}
        />
      )}

      {stage === "profiles" && (
        <ProfileReview
          profiles={profiles}
          onChange={setProfiles}
          onResolveClarifications={handleResolveClarifications}
          onBack={() => setStage("roster")}
          onSubmit={handleOptimize}
          loading={loading}
        />
      )}

      {stage === "results" && results && (
        <TeamResultsView results={results} onFlag={handleFlag} onBack={() => setStage("profiles")} />
      )}

      <footer className="foot">
        Backend: FastAPI + OR-Tools CP-SAT solver. Grok (xAI) handles free-text extraction, clarifying
        questions, and rationale generation — see <code>backend/app/grok_client.py</code> for the one place
        the API key is used.
      </footer>
    </div>
  );
}
