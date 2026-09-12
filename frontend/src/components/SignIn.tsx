import { useState, type FormEvent } from "react";
import { ChevronRight } from "lucide-react";
import { loginAccount, registerAccount } from "../api";
import { useCrewAuth } from "../auth";
import type { Role } from "../session";
import type { LoginResponse } from "../types";
import Mark from "./Mark";
import TerminalChrome from "./TerminalChrome";
import TopBar from "./TopBar";
import { Button } from "./ui/button";

function asText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value === "[object Object]" ? "" : value;
  if (value instanceof Error) return asText(value.message);
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(" ");
  if (typeof value === "object") {
    const rec = value as Record<string, unknown>;
    return asText(rec.msg) || asText(rec.detail) || asText(rec.message) || asText(rec.error_description);
  }
  return "";
}

function authErrorMessage(error: Error | undefined) {
  if (!error) return null;
  const extra = "error_description" in error ? asText((error as { error_description?: unknown }).error_description) : "";
  return extra || asText(error.message) || "Couldn't sign in.";
}

interface Props {
  onSignIn: (res: LoginResponse, demo?: boolean) => void;
  banner?: string | null;
}

export default function SignIn({ onSignIn, banner }: Props) {
  const auth = useCrewAuth();
  const [role, setRole] = useState<Role>("student");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("maya.singh@squadly.edu");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const authMessage = authErrorMessage(auth.error);
  const error = localError ?? authMessage ?? banner;
  const unauthorized = /unauthorized/i.test(error ?? "");
  const blocked = busy || auth.isLoading;
  const setupNeeded = !auth.configured;

  async function finishWithToken() {
    const token = await auth.getIdToken();
    if (!token) {
      throw new Error("Auth0 did not return a token. Try signing in again.");
    }
    const res = await loginAccount({ id_token: token, requested_role: role });
    onSignIn(res);
  }

  async function continueWithAuth0(mode: "login" | "signup" = "login") {
    if (setupNeeded) {
      setLocalError("Auth0 isn’t configured. Add VITE_AUTH0_DOMAIN and VITE_AUTH0_CLIENT_ID.");
      return;
    }
    setLocalError(null);
    setBusy(true);
    try {
      if (auth.isAuthenticated && mode === "login") {
        await finishWithToken();
        return;
      }
      await auth.login(role, mode);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Couldn't start Auth0 sign-in.");
      setBusy(false);
    }
  }

  async function continueWithAuth0Signup() {
    if (setupNeeded) {
      setMode("signup");
      setRole("student");
      setEmail("");
      setPassword("");
      setLocalError(null);
      return;
    }
    await continueWithAuth0("signup");
  }

  async function submitDemo(e: FormEvent) {
    e.preventDefault();
    if (mode === "signup") {
      if (!name.trim() || !email.trim() || !password) {
        setLocalError("Enter a name, email, and password to create an account.");
        return;
      }
      setLocalError(null);
      setBusy(true);
      try {
        const res = await registerAccount({
          name: name.trim(),
          email: email.trim(),
          password,
          requested_role: "student",
        });
        onSignIn(res, true);
      } catch (err) {
        setLocalError(asText(err) || "Couldn't create that account.");
        setBusy(false);
      }
      return;
    }
    if (!email.trim() || !password) {
      setLocalError("Enter the email and password stored in the database.");
      return;
    }
    setLocalError(null);
    setBusy(true);
    try {
      const res = await loginAccount({ email: email.trim(), password, requested_role: role });
      onSignIn(res, true);
    } catch (err) {
      setLocalError(asText(err) || "Couldn't sign in.");
      setBusy(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden">
      <TopBar left={<Mark />} />
      <div className="mx-auto grid w-full max-w-[1080px] items-center gap-12 px-8 py-10 sm:px-12 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] lg:gap-16 lg:px-16 lg:py-16 xl:gap-20">
        <section className="flex flex-col justify-center">
          <div className="max-w-xl rounded-2xl bg-card px-6 py-8 paper-shadow">
            <div className="kicker">team matching</div>
            <h1 className="mt-4 font-mono text-5xl font-semibold leading-[.95] tracking-[-0.05em] sm:text-6xl lg:text-7xl">
              squadly
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground sm:text-xl">
              Teams that actually work together, matched on hours, goals, and how people like to ship.
            </p>
            <ul className="mt-9 space-y-3 font-mono text-sm">
              <li>
                <span className="text-primary">01</span> chat once about how you work
              </li>
              <li>
                <span className="text-primary">10</span> get a team with real overlap
              </li>
              <li>
                <span className="text-primary">11</span> sign in with Auth0. roles stay on the server
              </li>
            </ul>
          </div>
        </section>

        <section className="flex justify-center lg:justify-end">
          <form className="w-full max-w-md" onSubmit={(e) => void submitDemo(e)}>
            <TerminalChrome title={mode === "signup" ? "signup@squadly:~" : "login@squadly:~"} bodyClassName="p-5 sm:p-7">
              <div className="kicker">$ auth --{mode} --role {role}</div>
              <h2 className="mt-2 font-mono text-2xl font-semibold tracking-[-0.03em]">
                {mode === "signup" ? "Create your account." : "Find your people."}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {mode === "signup"
                  ? "A name, email, and password. You can add Auth0 later."
                  : "Choose the desk you need, then continue."}
              </p>

              <div className="mt-6 grid grid-cols-2 rounded-md bg-muted p-1">
                <Button
                  type="button"
                  variant={role === "student" ? "default" : "ghost"}
                  onClick={() => {
                    setRole("student");
                    if (mode === "login") setEmail("maya.singh@squadly.edu");
                    setLocalError(null);
                  }}
                >
                  student
                </Button>
                <Button
                  type="button"
                  variant={role === "teacher" ? "default" : "ghost"}
                  onClick={() => {
                    setRole("teacher");
                    setMode("login");
                    setEmail("priya.chen@squadly.edu");
                    setLocalError(null);
                  }}
                >
                  teacher / ta
                </Button>
              </div>

              <div className="mt-6 space-y-3">
                {mode === "signup" && (
                  <>
                    <label htmlFor="signup-name" className="block font-mono text-xs text-primary">
                      name
                    </label>
                    <input
                      id="signup-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="h-11 w-full rounded-md border border-primary/25 bg-background px-3 font-mono text-sm outline-none ring-ring focus-visible:ring-2"
                      autoComplete="name"
                    />
                  </>
                )}
                <label htmlFor="demo-email" className="block font-mono text-xs text-primary">
                  {role === "teacher" ? "user@instructor" : "user@student"}
                </label>
                <input
                  id="demo-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 w-full rounded-md border border-primary/25 bg-background px-3 font-mono text-sm outline-none ring-ring focus-visible:ring-2"
                  autoComplete="username"
                />
                <label htmlFor="demo-password" className="block font-mono text-xs text-primary">
                  password
                </label>
                <input
                  id="demo-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 w-full rounded-md border border-primary/25 bg-background px-3 font-mono text-sm outline-none ring-ring focus-visible:ring-2"
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>

              {error && <p className="mt-5 rounded-md bg-warn-soft p-3 font-mono text-sm text-warn">{error}</p>}
              {unauthorized && (
                <p className="mt-3 text-sm text-muted-foreground">
                  Set Token Endpoint Authentication Method to None on this Auth0 SPA, then try again.
                </p>
              )}
              {setupNeeded && mode === "login" && !error && (
                <p className="mt-5 rounded-md bg-warn-soft p-3 font-mono text-sm text-warn">
                  Auth0 isn’t configured. Demo login still works, or create a local account below.
                </p>
              )}

              <Button size="lg" className="mt-6 w-full" type="submit" disabled={blocked}>
                {busy ? (mode === "signup" ? "creating…" : "signing in…") : mode === "signup" ? "./signup" : "./login --password"}
                <ChevronRight />
              </Button>

              <Button
                size="lg"
                variant="ghost"
                className="mt-2 w-full"
                type="button"
                disabled={blocked || setupNeeded}
                onClick={() => void continueWithAuth0("login")}
              >
                {busy || auth.isLoading ? "signing in…" : auth.isAuthenticated ? "continue" : "Continue with Auth0"}
                <ChevronRight />
              </Button>

              {role === "student" && !auth.isAuthenticated && mode === "login" && (
                <Button
                  variant="ghost"
                  className="mt-2 w-full"
                  type="button"
                  disabled={blocked}
                  onClick={() => void continueWithAuth0Signup()}
                >
                  Create an account
                </Button>
              )}

              {mode === "signup" && (
                <Button
                  variant="ghost"
                  className="mt-2 w-full"
                  type="button"
                  disabled={blocked}
                  onClick={() => {
                    setMode("login");
                    setEmail("maya.singh@squadly.edu");
                    setPassword("");
                    setLocalError(null);
                  }}
                >
                  Back to sign in
                </Button>
              )}

              <p className="mt-5 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {setupNeeded
                  ? "Create a local account here. When Auth0 is set, new accounts go through Google / Auth0 instead."
                  : "Auth0 / Google for new accounts. Demo email and password still work."}
              </p>
            </TerminalChrome>
          </form>
        </section>
      </div>
    </main>
  );
}
