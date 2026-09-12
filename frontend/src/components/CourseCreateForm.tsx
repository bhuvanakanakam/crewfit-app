import { ALL_SKILL_KEYS, SKILL_FIELDS } from "../types";
import { teamPlanHint } from "../lib/teams";
import SkillToggle from "./SkillToggle";
import { Button } from "./ui/button";

export interface CourseDraft {
  name: string;
  objective: string;
  teamSize: number;
  flex: boolean;
  teamCount: string;
  focusSkills: string[];
}

export const EMPTY_COURSE_DRAFT: CourseDraft = {
  name: "",
  objective: "",
  teamSize: 4,
  flex: true,
  teamCount: "",
  focusSkills: [...ALL_SKILL_KEYS],
};

interface Props {
  draft: CourseDraft;
  onChange: (draft: CourseDraft) => void;
  busy?: boolean;
  submitLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
  rosterHint?: number;
}

export default function CourseCreateForm({
  draft,
  onChange,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
  rosterHint = 20,
}: Props) {
  const minSize = draft.flex ? Math.max(2, draft.teamSize - 1) : draft.teamSize;
  const maxSize = draft.teamSize;
  const forced = draft.teamCount.trim() ? Number(draft.teamCount) : null;
  const hint = teamPlanHint(rosterHint, minSize, maxSize, Number.isFinite(forced) ? forced : null);
  const canSubmit = Boolean(draft.name.trim()) && draft.focusSkills.length > 0 && !busy;

  function toggleSkill(key: string) {
    const next = draft.focusSkills.includes(key)
      ? draft.focusSkills.filter((item) => item !== key)
      : [...draft.focusSkills, key];
    onChange({ ...draft, focusSkills: next.length ? next : draft.focusSkills });
  }

  return (
    <div className="mt-6 rounded-2xl border bg-card p-6 paper-shadow">
      <div className="kicker">New course</div>
      <h2 className="mt-1 font-display text-2xl font-medium tracking-[-0.03em]">How should teams form?</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        These settings feed the solver. The first roster is {rosterHint} students, then it uses whoever is actually enrolled.
      </p>

      <label htmlFor="course-name" className="mt-6 block text-sm font-semibold">
        Course name
      </label>
      <input
        id="course-name"
        value={draft.name}
        onChange={(e) => onChange({ ...draft, name: e.target.value })}
        className="mt-2 h-11 w-full rounded-xl bg-background px-3"
        placeholder="e.g. 15-213 Intro to Computer Systems"
      />

      <label htmlFor="course-objective" className="mt-4 block text-sm font-semibold">
        Objective
      </label>
      <textarea
        id="course-objective"
        value={draft.objective}
        onChange={(e) => onChange({ ...draft, objective: e.target.value })}
        className="mt-2 min-h-24 w-full rounded-xl bg-background px-3 py-3"
        placeholder="What should a good team be able to do together?"
      />

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-semibold">People per team</span>
          <input
            type="number"
            min={2}
            max={8}
            value={draft.teamSize}
            onChange={(e) => onChange({ ...draft, teamSize: Math.max(2, Math.min(8, Number(e.target.value) || 2)) })}
            className="mt-2 h-11 w-full rounded-xl bg-background px-3"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold">Number of teams</span>
          <input
            type="number"
            min={1}
            max={20}
            value={draft.teamCount}
            onChange={(e) => onChange({ ...draft, teamCount: e.target.value })}
            className="mt-2 h-11 w-full rounded-xl bg-background px-3"
            placeholder="Auto from roster"
          />
        </label>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.flex}
          onChange={(e) => onChange({ ...draft, flex: e.target.checked })}
        />
        Allow one person smaller if the roster doesn’t divide evenly
      </label>
      <p className="mt-2 text-sm font-semibold text-primary">{hint}</p>

      <p className="mt-5 text-sm font-semibold">Skills this course needs</p>
      <p className="mt-1 text-sm text-muted-foreground">The solver covers these first. Leave all on unless the project is narrower.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {SKILL_FIELDS.map((skill) => (
          <SkillToggle
            key={skill.key}
            label={skill.label}
            hint={skill.hint}
            on={draft.focusSkills.includes(skill.key)}
            onClick={() => toggleSkill(skill.key)}
          />
        ))}
      </div>

      <div className="mt-6 flex gap-2">
        <Button disabled={!canSubmit} onClick={onSubmit}>
          {busy ? "Creating…" : submitLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function draftToCreateBody(draft: CourseDraft) {
  const teamSize = draft.teamSize;
  const minSize = draft.flex ? Math.max(2, teamSize - 1) : teamSize;
  const count = draft.teamCount.trim() ? Number(draft.teamCount) : undefined;
  return {
    name: draft.name.trim(),
    objective: draft.objective.trim(),
    grading_notes: draft.objective.trim(),
    team_size_min: minSize,
    team_size_max: teamSize,
    ...(Number.isFinite(count) && count ? { team_count: count } : {}),
    focus_skills: draft.focusSkills,
  };
}
