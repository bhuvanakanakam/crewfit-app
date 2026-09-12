import { BookOpen, LayoutGrid, LogOut, MessageCircle, Users } from "lucide-react";
import type { ReactNode } from "react";
import Chip from "./Chip";
import Initials from "./Initials";
import Mark from "./Mark";
import TopBar from "./TopBar";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

type StudentView = "intake" | "saved" | "matching" | "team" | "update";

interface Props {
  staff: boolean;
  wide?: boolean;
  courseName: string;
  roleLabel: string;
  userName: string;
  deskTab: "students" | "teams";
  studentView: StudentView;
  hasTeam: boolean;
  notify: ReactNode;
  onDeskTab: (tab: "students" | "teams") => void;
  onOpenProfile: () => void;
  onOpenTeam: () => void;
  onChangeCourse: () => void;
  onSignOut: () => void;
}

export default function AppHeader({
  staff,
  wide,
  courseName,
  roleLabel,
  userName,
  deskTab,
  studentView,
  hasTeam,
  notify,
  onDeskTab,
  onOpenProfile,
  onOpenTeam,
  onChangeCourse,
  onSignOut,
}: Props) {
  const studentChat = studentView === "intake" || studentView === "saved" || studentView === "update";
  const studentTeam = studentView === "team" || studentView === "matching";

  const nav = staff ? (
    <>
      <NavPill active={deskTab === "students"} onClick={() => onDeskTab("students")} icon={<Users />}>
        Students
      </NavPill>
      <NavPill active={deskTab === "teams"} onClick={() => onDeskTab("teams")} icon={<LayoutGrid />}>
        Teams
      </NavPill>
    </>
  ) : (
    <>
      <NavPill active={studentChat} onClick={onOpenProfile} icon={<MessageCircle />}>
        Chat
      </NavPill>
      <NavPill active={studentTeam} disabled={!hasTeam && studentView !== "matching"} onClick={onOpenTeam} icon={<Users />}>
        Your team
      </NavPill>
    </>
  );

  return (
    <>
      <TopBar
        wide={wide}
        left={
          <Button
            variant="ghost"
            className="h-auto min-w-0 gap-3 rounded-lg px-1 py-1 hover:bg-transparent"
            onClick={onChangeCourse}
          >
            <Mark compact />
            <span className="hidden min-w-0 flex-col items-start leading-none sm:flex">
              <span className="font-mono text-lg font-semibold tracking-[-0.03em]">squadly</span>
              <span className="mt-1.5 max-w-[220px] truncate font-mono text-xs text-primary">{courseName}</span>
            </span>
          </Button>
        }
        center={<div className="hidden items-center gap-1 rounded-xl bg-muted p-1.5 md:flex">{nav}</div>}
        right={
          <>
            <Chip tone="accent" size="sm" className="hidden lg:inline-flex">
              {roleLabel}
            </Chip>
            {notify}
            <button
              type="button"
              onClick={onChangeCourse}
              className="hidden items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted md:flex"
            >
              <Initials name={userName} className="size-8 text-[10px]" />
              <span className="hidden text-left leading-tight xl:block">
                <span className="block text-sm font-semibold">{userName}</span>
                <span className="block text-xs text-muted-foreground">Switch course</span>
              </span>
            </button>
            <div className="flex items-center gap-1 border-l border-border pl-3">
              <Button variant="ghost" size="icon" className="size-10" aria-label="Courses" onClick={onChangeCourse}>
                <BookOpen />
              </Button>
              <Button variant="ghost" size="icon" className="size-10" aria-label="Sign out" onClick={onSignOut}>
                <LogOut />
              </Button>
            </div>
          </>
        }
      />
      <nav className="mt-3 flex justify-center px-4 md:hidden">
        <div className="flex items-center gap-1 rounded-xl border bg-card p-1.5">{nav}</div>
      </nav>
    </>
  );
}

function NavPill({
  active,
  children,
  onClick,
  disabled,
  icon,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-lg px-4 font-mono text-sm font-semibold transition-all [&_svg]:size-4",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-background hover:text-foreground",
        disabled && "opacity-40",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
