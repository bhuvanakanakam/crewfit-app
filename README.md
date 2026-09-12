# CrewFit

Constraint- based team formation for a cohort — parses free-text self-descriptions with Grok,
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

## The flow (student)

1. **Your prefs** — one short CMU-styled form (~1 minute). Up front you see exactly what’s needed:
   goal, day×time availability grid (Mon–Sun × morning/afternoon/evening), hours/week, and four
   named skills (Technical / Writing / Analysis / Presentation).
2. **Your team** — CP-SAT match against a Faker cohort. You only see teammate **names** plus Grok’s
   **why this team** line — never anyone else’s answers.

Organizer-style `/api/parse`, `/optimize`, and `/flag` endpoints remain for offline pipeline tests.

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

## Demo script (~2.5 min)

1. **(15s)** Problem: people pick teammates on vibes; teams break on goals, schedule, workload, skill gaps.
2. **(30s)** Load the sample roster; live-parse 2–3 ambiguous bios — show clarifying questions.
3. **(45s)** Optimize; walk team cards, score bars, and Grok rationales. Mention vetoes if you set any.
4. **(30s)** Point at CrewFit score vs random baseline.
5. **(30s)** Flag someone → show the local re-optimize note (swap, subset re-solve, or structural no-op).
6. **(10s)** Close: Optimization track — CP-SAT assigns; Grok only structures + explains.

## Team roles (fill in names)

| Area | Owner |
|---|---|
| Solver / scoring (`solver.py`, `scoring.py`) | _TBD_ |
| Grok integration (`grok_client.py`) | _TBD_ |
| Frontend flow | _TBD_ |
| Demo / pitch | _TBD_ |

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
    main.py          FastAPI: /api/chat, /match (+ parse/optimize/flag for tests)
    models.py         Pydantic schemas including student-facing MatchResponse
    scoring.py         compatibility model — no LLM calls
    solver.py           OR-Tools CP-SAT team assignment
    analysis.py          scoring helpers + flag re-optimize
    grok_client.py        chat_turn / extract / rationale — sole xAI touchpoint
    synthetic.py          Faker cohort for student match demos
    config.py
  tests/
    test_pipeline_small.py
    test_pipeline_full.py
  requirements.txt
  .env.example
frontend/
  src/
    App.tsx                   student stages: chat → matching → your team
    api.ts                    /chat and /match
    types.ts                  public teammate shape (name only) + student profile
    components/
      ChatInterview.tsx       Grok personality chat
      MyTeam.tsx              teammates + rationale (no prefs)
    index.css / app.css
```
