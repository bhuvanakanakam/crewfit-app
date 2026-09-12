# CrewFit

Constraint-based team formation for a cohort — parses free-text self-descriptions with Grok,
solves the actual team assignment with OR-Tools CP-SAT, and explains why each team was grouped
the way it was. Built for HackCMU 2026 (Optimization track).

## Stack

- **Backend:** FastAPI + OR-Tools (CP-SAT solver) + xAI Grok API
- **Frontend:** React + TypeScript + Vite (plain CSS, minimal CMU-themed — no UI framework)

Both halves are ordinary, independently deployable services — no monorepo tooling, no
proprietary build system — so the stack you develop with locally is the stack you deploy.

## Where the Grok API plugs in

**One file: `backend/app/grok_client.py`.** Nothing else in the codebase imports `openai` or
knows an LLM exists. Three call sites:

1. `extract_profile()` — free text → structured profile, with a confidence score and clarifying
   questions when something's genuinely ambiguous.
2. `resolve_clarification()` — folds a person's answers back into their profile.
3. `generate_rationale()` — turns a solved team's score breakdown into a one-line explanation.

If `XAI_API_KEY` is unset, every function falls back to a small heuristic (regex/keyword based)
so the whole app runs and is demoable with zero setup. Add your key and every response starts
coming from Grok instead — nothing else needs to change.

## Running it locally

**Backend:**

```bash
cd backend
python3 -m venv venv && source venv/bin/activate   # optional but recommended
pip install -r requirements.txt
cp .env.example .env   # then fill in XAI_API_KEY (optional — works without it)
uvicorn app.main:app --reload --port 8000
```

Verify it's alive: `curl http://localhost:8000/api/health` → `{"status": "ok"}`.

There's also a couple of standalone sanity scripts that exercise the whole pipeline without a
browser — useful when you're iterating on the scoring/solver logic:

```bash
cd backend
PYTHONPATH=. python3 tests/test_pipeline_small.py
PYTHONPATH=. python3 tests/test_pipeline_full.py   # also exercises the flag/re-optimize path
```

**Frontend** (separate terminal):

```bash
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (typically `http://localhost:5173`). The dev server proxies `/api/*`
to `http://localhost:8000` automatically (see `frontend/vite.config.ts`), so both halves talk to
each other with no extra config.

## The flow

1. **Course** — name the course/cohort and its grading notes. This matters more than it looks:
   grading notes are the context Grok uses to interpret what "pass," "grade A," "research," and
   "deep mastery" even mean for this specific class.
2. **Roster** — paste or type each person's free-text self-description (or load the sample
   16-person cohort to try it immediately).
3. **Profiles** — Grok's structured extraction comes back here. Anything ambiguous shows up as
   an inline clarifying question; everything is also directly editable in the table, so you're
   never blocked on a bad guess.
4. **Teams** — the CP-SAT solver's output: teams, per-team compatibility breakdown, a plain-language
   rationale, and a side-by-side comparison against randomly grouping the same roster. Each person
   has a flag (⚑) button that triggers a local re-optimization (single best swap) rather than
   reshuffling everyone.

## Solver notes (backend/app/solver.py)

Team assignment is modeled as an integer program and solved with OR-Tools CP-SAT: binary
variables for person→team assignment, a linearized pairwise "same team" variable, team-size
bounds, and an objective maximizing total pairwise compatibility. At cohort scale (tens of
people) this solves to a **provable optimum** in well under a second.

One deliberate design choice worth knowing about: **only an explicit organizer veto is a hard
constraint.** Zero schedule overlap between two people is heavily penalized in the objective,
not hard-excluded — an earlier version of this treated it as hard-infeasible, which broke on a
roster where, say, two weekend-only people had no one else to share a slot with. The current
version always finds a feasible assignment and is honest about remaining conflicts (shown as a
"⚠ N conflicts" badge on a team) rather than crashing.

**Known limitation:** the flag/re-optimize path only tries single swaps. If someone's schedule
conflict is structural (they're the only person free at a given time slot), no single swap can
fix it — you'd need a full re-solve of the affected subset. That's flagged as a TODO in
`backend/app/analysis.py::best_swap_for_person` rather than silently pretending it always works.

## Deploying

- **Backend:** any container-friendly host works (Render, Fly.io, Railway, a plain VM). It's a
  standard FastAPI app — `uvicorn app.main:app` — no exotic dependencies beyond OR-Tools, which
  ships prebuilt wheels for common platforms.
- **Frontend:** `npm run build` produces a static `dist/` folder — deploy it anywhere static
  hosting works (Vercel, Netlify, Cloudflare Pages, GitHub Pages). Set `VITE_API_BASE` to your
  deployed backend's URL at build time (it defaults to same-origin `/api`, which only works if
  you're proxying in production too).
- CORS is currently locked to `localhost:5173` in `backend/app/main.py` — update
  `allow_origins` to your deployed frontend's URL before shipping.

## Project layout

```
backend/
  app/
    main.py          FastAPI routes: /api/parse, /clarify, /optimize, /flag
    models.py         Pydantic request/response schemas
    scoring.py         the compatibility model — no LLM calls in this file
    solver.py           OR-Tools CP-SAT team assignment
    analysis.py          team scoring, random baseline, swap-based re-optimization
    grok_client.py        the ONE file that talks to xAI — see above
    config.py
  tests/
    test_pipeline_small.py   8-person sanity check
    test_pipeline_full.py     16-person cohort + flag/re-optimize path
  requirements.txt
  .env.example
frontend/
  src/
    App.tsx                 stage orchestration (course → roster → profiles → teams)
    api.ts                    typed fetch wrappers for the four endpoints
    types.ts                    shared TypeScript types, mirrors backend/app/models.py
    sampleData.ts                the same 16-person sample cohort used in backend tests
    components/
      CourseSetup.tsx
      RosterInput.tsx
      ProfileReview.tsx          structured table + inline clarifying questions
      TeamResults.tsx              team cards, score breakdown, flag/re-optimize UI
    index.css                       CMU-themed design tokens (Carnegie Red / Iron Gray)
    app.css                           layout and component styles
```
