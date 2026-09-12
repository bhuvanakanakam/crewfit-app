import { useState } from "react";
import type { Role } from "../session";

interface Props {
  onSignIn: (name: string, role: Role) => void;
}

export default function SignIn({ onSignIn }: Props) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("student");

  function submit() {
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
        <h1>Sign in</h1>
        <p className="page-dek">
          Students chat to build a profile, then get a team. Teachers open the course roster.
        </p>

        <label htmlFor="signin-name">You</label>
        <input
          id="signin-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="First name"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />

        <fieldset className="role-toggle">
          <legend>Role</legend>
          <button type="button" className={role === "student" ? "on" : ""} onClick={() => setRole("student")}>
            Student
          </button>
          <button type="button" className={role === "teacher" ? "on" : ""} onClick={() => setRole("teacher")}>
            Teacher
          </button>
        </fieldset>

        <button className="btn primary wide" type="button" disabled={!name.trim()} onClick={submit}>
          Continue
        </button>
      </div>
    </div>
  );
}
