import { useState } from "react";
import { loginAccount } from "../api";
import { useCrewAuth } from "../auth";
import type { Role } from "../session";
import type { LoginResponse } from "../types";

function authErrorMessage(error: Error | undefined) {
  if (!error) return null;
  const extra = "error_description" in error ? String((error as { error_description?: string }).error_description ?? "") : "";
  return extra || error.message;
}

interface Props {
  onSignIn: (res: LoginResponse, local: boolean) => void;
  banner?: string | null;
}

export default function SignIn({ onSignIn, banner }: Props) {
  const auth = useCrewAuth();
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("student");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const authMessage = authErrorMessage(auth.error);
  const error = localError ?? authMessage ?? banner;
  const unauthorized = /unauthorized/i.test(error ?? "");
  const blocked = busy || auth.isLoading;

  async function continueWithAuth0(mode: "login" | "signup" = "login") {
    setLocalError(null);
    setBusy(true);
    try {
      await auth.login(role, mode);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Couldn't start Auth0 sign-in.");
      setBusy(false);
    }
  }

  async function submitLocal() {
    const who = name.trim();
    if (!who || busy) return;
    setBusy(true);
    setLocalError(null);
    try {
      const res = await loginAccount(who, role);
      onSignIn(res, true);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Couldn't sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signin-page">
      <span className="blob peach" aria-hidden />
      <span className="blob sand" aria-hidden />

      <div className="signin-split">
        <div className="signin-brand">
          <span className="mark">C.</span>
          <p className="kicker">HackCMU 2026</p>
          <h1>CrewFit</h1>
          <p className="page-dek">Teams that actually work together — matched on hours, goals, and how people like to ship.</p>
          <ul className="signin-points">
            <li>Students chat once, then reuse the same working style.</li>
            <li>Teachers see flags, rematches, and preference changes live.</li>
            <li>TAs only open the courses they staff.</li>
          </ul>
        </div>

        <div className="signin-card">
          <h2>Sign in</h2>
          <p className="page-dek">Pick the view you should actually have. Students can’t open the instructor desk.</p>

          <fieldset className="role-toggle">
            <legend>I am a</legend>
            <button type="button" className={role === "student" ? "on" : ""} onClick={() => setRole("student")}>
              Student
            </button>
            <button type="button" className={role === "teacher" ? "on" : ""} onClick={() => setRole("teacher")}>
              Teacher / TA
            </button>
          </fieldset>

          {auth.configured ? (
            <>
              {error && <p className="signin-error">{error}</p>}
              {unauthorized && (
                <p className="signin-note">
                  Set Token Endpoint Authentication Method to None on this Auth0 SPA, then try again.
                </p>
              )}
              <div className="signin-actions">
                <button
                  className="btn primary wide"
                  type="button"
                  disabled={blocked}
                  onClick={() => void continueWithAuth0("login")}
                >
                  {auth.isLoading ? "Signing in…" : "Continue with Auth0"}
                </button>
                <button
                  className="btn ghost wide"
                  type="button"
                  disabled={blocked}
                  onClick={() => void continueWithAuth0("signup")}
                >
                  Create an account
                </button>
              </div>
              <label htmlFor="signin-name">Or continue with a name</label>
              <input
                id="signin-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={role === "teacher" ? "Priya Chen" : "Your name"}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitLocal();
                }}
              />
              <button className="btn ghost wide" type="button" disabled={!name.trim() || busy} onClick={() => void submitLocal()}>
                {busy ? "Checking…" : "Continue"}
              </button>
            </>
          ) : (
            <>
              <label htmlFor="signin-name">You</label>
              <input
                id="signin-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={role === "teacher" ? "Priya Chen" : "Your name"}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitLocal();
                }}
              />
              {error && <p className="signin-error">{error}</p>}
              <button className="btn primary wide" type="button" disabled={!name.trim() || busy} onClick={() => void submitLocal()}>
                {busy ? "Checking…" : "Continue"}
              </button>
            </>
          )}

          <p className="signin-note">
            Demo instructor <strong>Priya Chen</strong>. Demo TA <strong>Alex Kim</strong> (15-112 only).
          </p>
        </div>
      </div>
    </div>
  );
}
