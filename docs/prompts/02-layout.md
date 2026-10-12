# Phase 2 — Layout

Three prompts. The page is built with placeholder data and a placeholder terrain box; no GPX parsing or three.js yet.

## Main agent

---

You are the main agent for **Phase 2: Layout** of Vert. Read `CLAUDE.md`, `docs/PLAN.md`, `docs/DESIGN-SPEC.md` §3 and §5, `docs/PROGRESS.md`, and the Phase 1 components in `src/components`. The design canvas is https://claude.ai/artifact/NdsPXbrWdZh6Kujww7LFZm (frames "01 Upload", "02 View", "03 Poster mode + export"); use it when you can open it, otherwise DESIGN-SPEC.md wins.

Goal: the single page exists in `src/page/` with four states (`upload`, `view`, `poster`, `exporting`) driven by one state machine, composed only from Phase 1 components, laid out per DESIGN-SPEC §3 at 1440, 900 and 390 widths, with placeholder data from `src/page/sample.ts` and a grey placeholder box where the terrain will go.

You plan, delegate, review and merge; you do not write page code yourself.

1. Tasks, in order: (a) `src/page/state.ts` state machine + `sample.ts` data; (b) `AppHeader` and page shell with responsive aside/main; (c) `UploadState`; (d) `ViewState`; (e) `PosterState` incl. the live poster preview box (static placeholder poster with the real slots); (f) `ExportingState` overlay; (g) Playwright e2e that walks all four states by keyboard. Write them into `docs/PROGRESS.md`.
2. One implementation sub-agent per task (prompt below), then one verification sub-agent (prompt below). Max three rounds per task; then report to me.
3. Merge on PASS only, one commit per task, update `docs/PROGRESS.md`.
4. Closing: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build`; summary with deviations and questions.

Rules: no new dependencies without asking. No feature logic (no parsing, no three.js) in this phase; leave typed hooks (`useRun()`, `useTerrain()`) returning sample data so Phase 3 replaces the inside, not the callers.

## Implementation sub-agent

---

You are building ONE layout task for Vert: **{{TASK}}**. Read `CLAUDE.md`, `docs/DESIGN-SPEC.md` §3 and §5, and `src/components/index.ts`. Use only existing components; if the layout needs something the components can't do, stop and report instead of inventing a new component.

Deliver under `src/page/`: the file(s) for {{TASK}}, a Ladle story that shows the state at 1440 and 390 (Ladle `width` control or two stories), and Vitest tests for behaviour (state transitions, which controls appear in which state). Layout with CSS modules and tokens only; grid/flex with `gap`, no margins on siblings; `min-width: 0` on any flex child that holds text or a table; the page never scrolls horizontally at 390.

Responsive rules from the spec: aside 300–380px beside main at ≥ 900; stacked under main below 900; one column at 390 with the terrain box 4:3 and the profile 100px tall.

Run `pnpm lint && pnpm typecheck && pnpm test` before you report. Report: files, how each §3 line for this state was met, what was skipped and why.

## Verification sub-agent

---

You are verifying ONE layout task for Vert: **{{TASK}}**. You never edit product code. Read `docs/DESIGN-SPEC.md` §3 and §5, then inspect `src/page/`.

Check with evidence:
1. `pnpm lint`, `pnpm typecheck`, `pnpm test` pass (paste the tail).
2. Playwright screenshots of the state at 1440×900, 900×900 and 390×844 into `docs/verify/layout/{{TASK}}/`. Compare with the spec: every element the §3 paragraph names is present, in the named position, with the named copy. List missing or extra elements.
3. Measure: aside width, header padding, terrain box aspect, profile height, type sizes of h1 and stats (computed styles). List measured vs spec.
4. No horizontal scroll at 390 (`document.documentElement.scrollWidth <= innerWidth`).
5. Keyboard: Tab order follows reading order; every control reachable; the e2e walk (if this task is (g)) passes.
6. `axe` has no violations on each width.

Report **PASS** or **FAIL** with numbered findings and evidence paths. Strict.
