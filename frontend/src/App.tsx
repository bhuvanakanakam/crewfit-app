import { useState } from "react";
import "./app.css";
import IntakeForm from "./components/IntakeForm";
import MyTeam from "./components/MyTeam";
import { findMatch } from "./api";
import { DEFAULT_COURSE, type MatchResponse, type StructuredProfile } from "./types";

type Stage = "intake" | "matching" | "team";

export default function App() {
  const [stage, setStage] = useState<Stage>("intake");
  const [profile, setProfile] = useState<StructuredProfile | null>(null);
  const [match, setMatch] = useState<MatchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(p: StructuredProfile) {
    setProfile(p);
    setStage("matching");
    setError(null);
    try {
      const res = await findMatch(p, DEFAULT_COURSE, 16);
      setMatch(res);
      setStage("team");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't find a team.");
      setStage("intake");
    }
  }

  function restart() {
    setProfile(null);
    setMatch(null);
    setError(null);
    setStage("intake");
  }

  return (
    <div className="cmu-app">
      <div className="utility-bar">
        <div className="utility-inner">
          <nav aria-label="Audience">
            <a href="https://www.cmu.edu/">CMU Home</a>
            <span aria-hidden>|</span>
            <span>Current Students</span>
          </nav>
          <div className="utility-actions">
            <span className="pill-link">HackCMU</span>
          </div>
        </div>
      </div>

      <header className="site-header">
        <div className="site-header-inner">
          <a className="wordmark" href="/" aria-label="Carnegie Mellon University — CrewFit">
            <span className="wm-cmu">Carnegie Mellon University</span>
            <span className="wm-product">CrewFit</span>
          </a>
          <nav className="main-nav" aria-label="Primary">
            <span className={stage === "intake" ? "active" : ""}>1 · Your prefs</span>
            <span className={stage !== "intake" ? "active" : ""}>2 · Your team</span>
          </nav>
        </div>
        <div className="header-rule" />
      </header>

      <main className="site-main">
        <p className="breadcrumb">
          <a href="https://www.cmu.edu/">CMU</a> / <span>CrewFit</span> /{" "}
          <span>{stage === "team" ? "Your team" : "Team match"}</span>
        </p>

        {error && <div className="error-banner">{error}</div>}

        {stage === "intake" && (
          <>
            <h1 className="page-title">Find your project team</h1>
            <p className="page-dek">
              Tell us how you work in one short form. We match you with a constraint solver — you
              only see your teammates and why, never anyone else’s answers.
            </p>
            <IntakeForm onSubmit={handleSubmit} />
          </>
        )}

        {stage === "matching" && (
          <div className="matching-state">
            <h1 className="page-title">Finding your team…</h1>
            <p className="page-dek">Running the optimizer. Your preferences stay private.</p>
          </div>
        )}

        {stage === "team" && match && profile && (
          <MyTeam result={match} yourName={profile.name} onRestart={restart} />
        )}
      </main>

      <footer className="site-footer">
        <div className="site-footer-inner">
          <div>
            <strong>Carnegie Mellon University</strong>
            <p>5000 Forbes Avenue, Pittsburgh, PA 15213</p>
          </div>
          <p className="footer-note">
            CrewFit · OR-Tools CP-SAT assigns teams · Grok explains the match · Preferences stay
            private
          </p>
        </div>
      </footer>
    </div>
  );
}
