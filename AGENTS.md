# Agent guide: Umpire's Eye

A web game for phones and desktops: call real 2026 MLB pitches from the plate umpire's eye at real speed, then see the ABS call (our reconstruction), the real umpire's call, and your umpire card.

Read `README.md` to build and run it, `docs/HOW-IT-WORKS.md` for how the pieces fit, `docs/DATA.md` for the data, and `PRODUCT.md` for who it's for and the design principles.

## Build, run and test

- Node 22.18 or later. `npm ci` installs.
- The season data is built locally from MLB's Stats API: `npm run data:fetch` once, then `npm run data:build`, `npm run data:daily` and `npm run data:validate`. `docs/DATA.md` has the details, including the first `data:daily` run's `--from` and `--through`.
- `npm run dev` serves the app, and `npm run build` builds it into `dist/`. `npm run assets` rebuilds the shipped images, fonts and World Series pool from the masters in `art/`.
- Checks: `npm run lint`, `npm run typecheck`, `npm test` (Vitest, then the data tests) and `npm run data:validate`.
- Browser tests: `npm run e2e`, with specs or Playwright flags after `--`. Install the browsers once with `npx playwright install chromium webkit`. Outside CI the Chromium projects run in the installed Microsoft Edge (`channel: 'msedge'`).
  - `npm run e2e` holds a lock file in the OS temp folder, so runs on one machine take turns: several at once slow each other, and WebKit then misses its timeouts. Anything that launches browsers should go through it (a script can use `scripts/e2e-lock.ts`); `npx playwright test` skips it. It's skipped when `CI` is set.
  - `UE_E2E_PORT` sets the test server's port (4173 by default).

## Rules

- Stay honest. Real data is labelled real, the ABS call is labelled as our reconstruction, and the players, field and catch are illustrations. Never invent numbers, users or quotes.
- No MLB or team logos, and no player likenesses.
- The data comes from the MLB Stats API, © MLB Advanced Media, L.P., under MLB's terms: "Only individual, non-commercial, non-bulk use of the Materials is permitted and any other use of the Materials is prohibited without prior written authorization from MLBAM." ([source](https://gdx.mlb.com/components/copyright.txt)). Quote the terms, don't restate them. Not affiliated with MLB.
- `tests/reference/index.html` is the design reference that the parity and speed tests compare the app against. Change it only on purpose.
- Keep usernames, home-folder paths and account names out of files and commit messages.
- Never commit a lockfile whose `resolved` URLs point anywhere other than registry.npmjs.org; `npm run lint` checks it.

## Code style

- Put a blank line after variable declarations, before the next statement. Lint enforces it.
- Put a blank line before a `return` that follows other statements. Lint enforces it.
- Comments must be earned: say why, not what. Don't write comments that restate the code.
- Use strict TypeScript. Keep the math (kinematics, ABS truth, lens fit, seeded RNG, stance, dealing) in pure modules with no DOM imports. `src/core/` is shared with the data tools, and lint and its tsconfig keep it free of DOM globals, Node APIs, `import.meta.env` and `Math.random`.

## Testing

- Every behaviour change comes with a test.
- Browser tests use Playwright: desktop Edge and WebKit, and phones in device emulation, with WebKit standing in for Safari.
- When an e2e test fails, read its `error-context.md` (the page snapshot at the failure) before re-running anything. A test that fails the same way twice is a bug: fix its cause, and don't add retries or longer timeouts.
- When a test must allow an expected console error, match it by its exact source URL, assert how many times it happened, and keep failing on every other console or page error.
- When a test guards something (a cache, a rule, a budget), break the guarded thing locally, check that the test fails, then revert. Where the guarded cost is smaller than a frame, count the work instead of timing it.
- Data tests use small synthetic fixtures, not recorded MLB responses.