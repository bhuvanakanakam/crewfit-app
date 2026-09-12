# PRD, CrewFit (HackCMU 2026)

*Status: backend + frontend built, tested, and running locally. This supersedes the earlier
planning-only version of this doc, it now reflects what's actually built, what changed during
implementation, and what's still open.*

## 1. Problem Statement

Forming teams within a cohort (new grads, course sections, hackathons) fails silently. People pick
teammates based on visible traits (major, friendliness) that don't predict what actually breaks
teams: mismatched goals (pass vs. A vs. research vs. mastery), incompatible schedules, uneven
workload expectations, and unaddressed role/skill gaps. Teams that look fine on day one fall apart
by week three.

## 2. Track & Positioning

- **Submitting under: Optimization.** The core is a constraint-based group-assignment problem (a
  correlation-clustering / group-technology formulation), not a matchmaking feature dressed up
  with AI.
- **Surface feel:** a "find your people" tool, covers usefulness and demo appeal, but the
  technical center and pitch stay on the solver.
- **Sponsor angle:** Grok (xAI) for structured extraction + rationale generation. IFM's K2 models
  as an alternate backend for the same steps was considered as a way to also qualify for their
  prize track, **not implemented**; would slot into `grok_client.py` alongside the xAI client if
  pursued.
- **Known prior art, CATME Team-Maker.** Researched directly (CATME is the established
  instructor-run team-formation tool in engineering education; its algorithm optimizes a maximin
  objective, maximize the score of the *worst* team, over instructor-defined survey criteria).
  CrewFit's honest differentiation, worth having ready if a judge brings CATME up:
  - **Intake:** CATME requires an instructor to design a structured survey up front. CrewFit takes
    free-text self-description and has Grok structure it, no admin setup step.
  - **Explainability:** CATME reports a quality score against instructor criteria. CrewFit
    generates a plain-language rationale per team, aimed at the students themselves.
  - **Dispute handling:** CATME's "remake teams" loop is instructor-driven and global. CrewFit's
    flag flow is student-initiated and local, one person flags a concern, only the affected
    subset gets re-optimized.
  - Published research has proposed adding Gale-Shapley (stable matching) to CATME specifically
    because preference-structure was seen as a gap, validates this general direction as a
    recognized research angle, not an invented one.

## 3. Data Schema (as implemented)

Matches `backend/app/models.py` exactly:

```json
{
  "goal": "pass | grade_A | research | deep_mastery",
  "availability": ["weekday_morning", "weekday_afternoon", "weekday_evening", "weekend"],
  "skills": {"technical": 4, "writing": 2, "analysis": 3, "presentation": 5},
  "hours": 8,
  "role": "lead | contributor | either",
  "conflict_mode": "vote | rotate_lead | escalate | defer_to_invested",
  "confidence": 0.9,
  "clarifying_questions": []
}
```

Two deviations from the original plan, both deliberate:

- `availability` is a list in the backend/schema (a person can have multiple slots), but the
  frontend's editable table currently only lets you set **one** slot per person for simplicity.
  Grok's extraction can still return multiple slots, the table just doesn't expose editing more
  than one. Worth revisiting if multi-slot availability turns out to matter in practice.
- `confidence` and `clarifying_questions` were added beyond the original schema sketch,
  necessary once the "Grok comes back with questions if ambiguous" requirement was locked in.

## 4. Compatibility Scoring (as implemented, `backend/app/scoring.py`)

```
score(i, j) = 0.35 · goal_alignment(i, j)
            + 0.25 · availability_jaccard(i, j)
            + 0.20 · skill_complementarity(i, j)
            + 0.15 · workload_similarity(i, j)
            + 0.05 · role_bonus(i, j)
```

- `goal_alignment`, lookup table; same goal = 1.0, adjacent goals (e.g. grade_A ↔ deep_mastery)
  score 0.8, opposite goals (pass ↔ research) score 0.1.
- `skill_complementarity`, rewards coverage (max of the pair's rating per category), not just
  similarity.
- `workload_similarity`, normalized difference in weekly hours.
- `role_bonus`, small penalty for two "lead"-only people on a team, small bonus for
  lead/contributor pairs.

**Important change from the original plan:** the original PRD called for a *hard* exclusion on
zero-availability-overlap pairs. Testing surfaced a real failure mode, a small roster where two
weekend-only people had no one else to share a slot with made the whole assignment **infeasible**,
not just suboptimal. Fixed by making zero-overlap a steep penalty in the objective (-1.5) instead
of a hard constraint, while keeping **explicit organizer vetoes** as the only true hard exclusion
in the solver. This keeps the solver always feasible and it now reports remaining conflicts
honestly (a "⚠ N conflicts" badge) rather than crashing.

## 5. Solver (as implemented, `backend/app/solver.py`)

Built with **OR-Tools CP-SAT**, not the greedy/local-search fallback from the original plan:

- Binary variable `x[i, t]`: person i assigned to team t.
- Linearized `y[i, j, t]`: 1 iff i and j share team t.
- Constraints: each person on exactly one team; team size within `[min, max]`; explicit vetoes
  hard-excluded.
- Objective: maximize total pairwise compatibility across all teams.

Verified against an 8-person and a 16-person sample cohort (`backend/tests/`), solves to a
provable optimum in well under a second at this scale, and correctly surfaces unavoidable
scheduling conflicts as violations rather than hiding them.

**Known limitation, found during testing, not yet fixed:** the flag/re-optimize path
(`analysis.py::best_swap_for_person`) only tries single swaps. If a person's conflict is
structural, they're the only one available at a given time slot, no single swap can rescue
them; a full re-solve of the affected subset would be needed. Documented as a TODO rather than
silently pretending it always works. Good "future work" answer if a judge asks about edge cases.

## 6. Grok (xAI) Integration, implemented

All three call sites live in **`backend/app/grok_client.py`**, nothing else in the codebase
imports `openai` or knows an LLM exists:

1. `extract_profile()`: free text → structured profile, with a confidence score and up to two
   clarifying questions when something's genuinely ambiguous. Uses `response_format:
   json_schema` against a fixed schema, `temperature=0.2`.
2. `resolve_clarification()`: folds a person's answers back into their profile by re-running
   extraction with the Q&A appended as context.
3. `generate_rationale()`: turns a solved team's score breakdown into a one-line explanation.

**Fallback behavior:** if `XAI_API_KEY` is unset, all three fall back to a heuristic (regex/keyword
matching), so the app is fully runnable and demoable with zero setup. This was deliberately kept
rather than requiring a key to run, verified working via `curl` against a live local server,
including a genuinely ambiguous test bio ("not sure yet, will figure it out") correctly producing
low confidence (0.55) and two clarifying questions.

**Status: a real xAI key has been added** to `backend/.env` on the user's local machine (not
committed, `.env` is gitignored, and the remote file-transfer tool used to move this project
refuses to write `.env` files at all, so it was added manually).

## 7. Frontend, implemented (`frontend/`)

React + TypeScript + Vite, plain CSS (no UI framework), CMU-themed: Carnegie Red `#C41230` and
Iron Gray `#6D6E71`, confirmed against CMU's official brand page rather than guessed.

Implements the exact flow requested: the app loads on a **Course** screen (name + grading notes,
this context is what Grok uses to interpret what "pass" vs. "research" even means for that
specific class), then **Roster** (free-text input per person, or load the sample 16-person
cohort), then **Profiles** (Grok's structured extraction, with ambiguous fields surfaced as inline
clarifying questions, and every field directly editable as a fallback), then **Teams** (the
output format worked out earlier in planning: team cards, per-team score breakdown bars, a
plain-language rationale, a side-by-side comparison against randomly grouping the same roster, and
a flag ⚑ button per person that triggers the local re-optimization).

Verified: `npm run build` compiles clean with no TypeScript errors; the dev server's Vite proxy
correctly forwards `/api/*` to the FastAPI backend with no extra config.

## 8. Deployment / Local Setup, done

- Full project pushed from the build environment to the user's Mac at
  `Documents/Projects/crewfit-app` (36 files, verified written, directory structure intact).
- Backend dependency issue found and fixed: `ortools==9.11.4210` (the original pin) has no wheel
  for the user's Python/platform combination; loosened to `ortools>=9.11,<10`, which resolves to
  `9.15.6755` on their machine, re-verified the solver still works correctly against that version
  before pushing the fix.
- `.env` with the real xAI key added locally by the user (the remote file bridge used to move
  this project blocks writing `.env` files as a safety measure, so this step couldn't be
  automated).

## 9. MVP Scope, status

**Must-have (done):**
- ✅ Structured extraction from free text (Grok, with heuristic fallback).
- ✅ Working CP-SAT solve producing valid, constraint-respecting teams.
- ✅ Rationale generation per team.
- ✅ Naive/random baseline comparison, shown side by side in the UI.

**Should-have (done):**
- ✅ Clarifying-question loop for low-confidence profiles (done as a live inline flow, not just a
  single pre-solve pass, arguably exceeds the original "should-have" scope).
- ✅ Local re-optimization on a flagged team (with the known single-swap limitation above).
- ⬜ Veto/preference input before the first solve, the backend model supports vetoes
  (`OptimizeRequest.vetoes`), but there's no frontend UI to set them yet.

**Won't-have (unchanged):**
- Swap marketplace / decentralized negotiation.
- Multi-session persistence, auth, real user accounts.
- Personality/communication-style modeling.

## 10. Judging Criteria Alignment

| Criteria | Status |
|---|---|
| Originality | Correlation-clustering framing + CATME-aware differentiation (Section 2), a fresh angle backed by real prior-art awareness, not just "we didn't know this existed." |
| Technical Difficulty | Real OR-Tools CP-SAT model, verified solving to a provable optimum; solver logic is entirely custom, LLM never picks teams. |
| Demo Quality | Full flow built and working end to end: course → roster → profiles → teams, with live baseline comparison. |
| Usefulness | Solves the stated real problem; scoring model and edge-case handling (Section 4) were shaped by actual testing, not just theory. |
| Relevance (Optimization track) | Submission's technical center is explicitly the constrained optimization solve. |

## 11. Open Items

- Section on team role split (who owns what across your 4 teammates) still needs real names,
  hasn't been filled in yet.
- No frontend UI for setting vetoes yet, despite backend support.
- IFM K2 as an alternate/local model backend, not started; would be additive for their sponsor
  prize track specifically.
- Demo script and 24-hour timeline from the original plan still stand as written; not yet
  rehearsed against the actual built app.
- Decide whether the very first throwaway client-side prototype (an in-browser-only version built
  before this real backend/frontend) is worth keeping around for anything, recommendation is no,
  this build supersedes it entirely.

## 12. Reference: Demo Script (unchanged from planning, still the target)

1. (15s) State the problem in one sentence.
2. (30s) Show a messy roster of free-text profiles; live-parse two or three into structured JSON.
3. (45s) Run the solver; show resulting teams with per-team rationale.
4. (30s) Show the same roster grouped naively/randomly side by side.
5. (30s) Show the flag-a-concern → local re-optimization path.
6. (10s) Close on track relevance.
