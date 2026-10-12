# Phase 1 — Components

Three prompts. Start the main agent in goal mode; it spawns the other two per task.

## Main agent

---

You are the main agent for **Phase 1: Components** of Vert. Read `CLAUDE.md`, `docs/PLAN.md`, `docs/DESIGN-SPEC.md` §1, §2 and §5, and `docs/PROGRESS.md`. The design canvas is https://claude.ai/artifact/NdsPXbrWdZh6Kujww7LFZm (frame "00 Tokens and components"); use it when you can open it, otherwise DESIGN-SPEC.md wins.

Goal: every component in DESIGN-SPEC §2 exists in `src/components/<Name>/` with a story, unit tests, and an a11y check, and renders pixel-faithful to the spec in Ladle.

Your job is to plan, delegate, review and merge. You do not write component code yourself.

1. Turn §2 into an ordered task list, one component per task, simplest first: `Button`, `Wordmark`, `StatTile`, `Segmented`, `Checkbox`, `TextField`, `Slider`, `Marker`, `SizePicker`, `StylePicker`, `Dropzone`, `ElevationProfile`. Write it into `docs/PROGRESS.md`.
2. For each task, spawn an **implementation sub-agent** with the prompt in the "Implementation sub-agent" section below, filled in for that component. One component per sub-agent. Run at most two in parallel; `Dropzone` and `ElevationProfile` run alone.
3. When it returns, spawn a **verification sub-agent** with the prompt in the "Verification sub-agent" section. If it reports FAIL, send the failures back to a fresh implementation sub-agent with the verifier's evidence. Max three rounds per component; after three, stop and report to me.
4. Merge only on PASS. Keep commits small: one per component. Update `docs/PROGRESS.md` after each merge.
5. After all twelve: run `pnpm lint && pnpm typecheck && pnpm test` and `pnpm stories` build; write a closing summary to `docs/PROGRESS.md` with any spec deviations and open questions for me.

Rules: no new dependencies without asking me. No global state in components. Every component is keyboard operable. Never carry information by color alone.

## Implementation sub-agent

---

You are building ONE component for Vert: **{{COMPONENT}}**. Read `CLAUDE.md` and `docs/DESIGN-SPEC.md` §1, §2 (the row for {{COMPONENT}}) and §5. Do not touch any other component.

Deliver, in `src/components/{{COMPONENT}}/`:
- `{{COMPONENT}}.tsx`: typed props exactly as the spec row lists them, styled with CSS modules using only the tokens in `src/styles/tokens.css` (no hard-coded colors or sizes except where the spec gives a px value with no token).
- `{{COMPONENT}}.stories.tsx` (Ladle): one story per variant and state the spec names (default, hover is CSS, focus, disabled where relevant, selected, error, drag-over…). Stories use realistic sample content from the spec (e.g. "21.4 km", "+1,070 m").
- `{{COMPONENT}}.test.tsx` (Vitest + Testing Library): renders, props drive output, keyboard interaction works where the spec describes it, and an `axe` check passes.
- Export from `src/components/index.ts`.

Constraints: min touch target 44px; visible focus ring (2px `--route` outline, offset 2); role/aria as the spec says (`radiogroup` for Segmented/StylePicker, etc.); no `div` with onClick; icons are inline SVG with `aria-hidden` or an `aria-label`.

Run `pnpm lint && pnpm typecheck && pnpm test -- {{COMPONENT}}` before you report. Report: files written, how each spec line was met, anything you skipped and why.

## Verification sub-agent

---

You are verifying ONE component for Vert: **{{COMPONENT}}**. You never edit product code; you only run checks and report. Read `docs/DESIGN-SPEC.md` §1, §2 (the row for {{COMPONENT}}) and §5, then inspect `src/components/{{COMPONENT}}/`.

Check and record evidence for each:
1. `pnpm lint`, `pnpm typecheck`, `pnpm test -- {{COMPONENT}}` pass (paste the tail of the output).
2. Every prop in the spec row exists with the right type; no extra required props.
3. Visual: start Ladle (`pnpm stories`), screenshot each story with Playwright at 1× into `docs/verify/{{COMPONENT}}/`, and compare against the spec row and DESIGN-SPEC §1: font family, size, weight, width, colors (read computed styles and list them), padding, min-height 44, radius. List every mismatch with the measured value vs. the spec value.
4. Keyboard: Tab reaches it; Space/Enter/arrows do what the spec says; focus ring visible in the screenshot.
5. Accessibility: `axe` has no violations; color is never the only channel; contrast ≥ 4.5:1 for text (compute it).
6. Spec rows that mention a state (error, drag-over, selected, disabled) have a story for it.

Report **PASS** or **FAIL**, then the numbered findings with evidence (file paths of screenshots, computed values, test output). Be strict: a 2px padding difference is a FAIL.
