import { useState } from "react";
import { useCrewAuth } from "../auth";
import type { Role } from "../session";

function authErrorMessage(error: Error | undefined) {
  if (!error) return null;
  const extra = "error_description" in error ? String((error as { error_description?: string }).error_description ?? "") : "";
  return extra || error.message;
}

interface Props {
  onSignIn: (name: string, role: Role) => void;
}

export default function SignIn({ onSignIn }: Props) {
  const auth = useCrewAuth();
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("student");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const authMessage = authErrorMessage(auth.error);
  const error = localError ?? authMessage;
  const unauthorized = /unauthorized/i.test(error ?? "");

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

  function submitLocal() {
    const who = name.trim();
    if (!who) return;
    onSignIn(who, role);
  }

  return (
    <div className="signin-page">
      <span className="blob peach" aria-hidden />
      <span className="blob clay" aria-hidden />
      <span className="blob sand" aria-hidden />
      <span className="blob coral" aria-hidden />

      <div className="signin-card">
        <span className="mark">C.</span>
        {auth.isLoading ? (
          <>
            <h1>Signing you in…</h1>
            <p className="page-dek">Checking your Auth0 session.</p>
          </>
        ) : (
          <>
            <h1>Sign in</h1>
            <p className="page-dek">
              Students chat to build a profile, then get a team. Teachers open the course roster.
            </p>

            <fieldset className="role-toggle">
              <legend>Role</legend>
              <button type="button" className={role === "student" ? "on" : ""} onClick={() => setRole("student")}>
                Student
              </button>
              <button type="button" className={role === "teacher" ? "on" : ""} onClick={() => setRole("teacher")}>
                Teacher
              </button>
            </fieldset>

            {auth.configured ? (
              <>
                {error && <p className="signin-error">{error}</p>}
                {unauthorized && (
                  <p className="signin-note">
                    Auth0 signed you in, then rejected the token request. In the dashboard open this
                    application → <strong>Credentials</strong> (or Settings → Advanced → OAuth) and set{" "}
                    <strong>Token Endpoint Authentication Method</strong> to <strong>None</strong>. The
                    application type must be Single Page Application. Also add{" "}
                    <code>https://localhost:5173</code> to Allowed Origins (CORS) and Allowed Web Origins,
                    then try Continue with Auth0 again.
                  </p>
                )}
                <div className="signin-actions">
                  <button
                    className="btn primary wide"
                    type="button"
                    disabled={busy}
                    onClick={() => void continueWithAuth0("login")}
                  >
                    Continue with Auth0
                  </button>
                  <button
                    className="btn ghost wide"
                    type="button"
                    disabled={busy}
                    onClick={() => void continueWithAuth0("signup")}
                  >
                    Create an account
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="signin-note">
                  Add <code>VITE_AUTH0_DOMAIN</code> and <code>VITE_AUTH0_CLIENT_ID</code> in{" "}
                  <code>frontend/.env.local</code> to enable Auth0. Until then you can sign in locally.
                </p>
                <label htmlFor="signin-name">You</label>
                <input
                  id="signin-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="First name"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitLocal();
                  }}
                />
                {error && <p className="signin-error">{error}</p>}
                <button className="btn primary wide" type="button" disabled={!name.trim()} onClick={submitLocal}>
                  Continue
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
