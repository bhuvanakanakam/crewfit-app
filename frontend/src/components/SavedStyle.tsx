import { MessageCircle } from "lucide-react";
import type { Course, MatchResponse, StructuredProfile } from "../types";
import { CONFLICT_LABELS, GOAL_LABELS, ROLE_LABELS } from "../types";
import Chip from "./Chip";
import PageIntro from "./PageIntro";
import { SkillBars } from "./WeekCalendar";
import { Button } from "./ui/button";

interface Props {
  profile: StructuredProfile;
  course: Course;
  onMatch: () => void;
  onUpdate: () => void;
  onViewTeam?: () => void;
  onRematch?: () => void;
  hasTeam?: boolean;
  rematchAllowed?: boolean;
  matching?: boolean;
  waiting?: boolean;
  team?: MatchResponse | null;
}

export default function SavedStyle({
  profile,
  onMatch,
  onUpdate,
  onViewTeam,
  onRematch,
  hasTeam,
  rematchAllowed,
  matching,
  waiting,
}: Props) {
  const first = profile.name.split(" ")[0] || profile.name;

  return (
    <div>
      <PageIntro
        kicker="Chat"
        title="Your working style"
        body="This is private. squadly uses it to score fit, not to label you."
      />

      <div className="mt-8 grid gap-5 md:grid-cols-[1fr_290px]">
        <section className="rounded-2xl border bg-card p-6 paper-shadow">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-2xl font-medium tracking-[-0.03em]">How {first} works</h2>
            <Chip tone="good">Complete</Chip>
          </div>
          <dl className="mt-6 grid gap-5 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-bold uppercase text-muted-foreground">Goal</dt>
              <dd className="mt-1 text-lg font-semibold">{GOAL_LABELS[profile.goal]}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase text-muted-foreground">Hours</dt>
              <dd className="mt-1 text-lg font-semibold">{profile.hours} per week</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase text-muted-foreground">Team role</dt>
              <dd className="mt-1 text-lg font-semibold">{ROLE_LABELS[profile.role]}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase text-muted-foreground">Conflict style</dt>
              <dd className="mt-1 text-lg font-semibold">{CONFLICT_LABELS[profile.conflict_mode]}</dd>
            </div>
          </dl>
          <div className="mt-7 border-t pt-6">
            <p className="mb-4 font-semibold">Skill confidence</p>
            <SkillBars privateView skills={profile.skills} />
          </div>
        </section>

        <aside className="rounded-2xl border bg-foreground p-6 text-primary-foreground paper-shadow">
          <MessageCircle className="text-peach" />
          <h2 className="mt-8 font-display text-2xl font-medium tracking-[-0.03em]">
            {hasTeam ? "Your crew is ready." : "Ready when you are."}
          </h2>
          <p className="mt-2 text-sm opacity-75">
            {hasTeam
              ? "See your shared plan and why the match works."
              : "Your profile has enough signal to build a strong team."}
          </p>
          <Button
            size="lg"
            className="mt-6 w-full bg-card text-foreground hover:bg-accent-soft"
            disabled={matching}
            onClick={hasTeam ? onViewTeam : onMatch}
          >
            {matching ? "Finding your team…" : hasTeam ? "Open your team" : "Find my team"}
          </Button>
          <Button
            variant="ghost"
            className="mt-2 w-full text-primary-foreground hover:bg-card/10 hover:text-primary-foreground"
            disabled={matching}
            onClick={onUpdate}
          >
            {hasTeam ? "Update preferences" : "Tweak preferences first"}
          </Button>
          {hasTeam && rematchAllowed && (
            <Button
              variant="ghost"
              className="mt-2 w-full text-primary-foreground hover:bg-card/10 hover:text-primary-foreground"
              disabled={matching}
              onClick={onRematch}
            >
              Redo team matching
            </Button>
          )}
        </aside>
      </div>
    </div>
  );
}
