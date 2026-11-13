# Agent guide: Umpire's Eye

Read this first, then `docs/PLAN.md` (milestones, decisions, who owns what) and `PRODUCT.md`.

## What this is

A web game for phones and desktops: call real 2026 MLB pitches from the plate umpire's eye at real speed, then see the ABS truth, the real ump's call, and your umpire card.

The approved look and behaviour live in `mockup/`. Open `mockup/index.html` to play it. `mockup/README.md` documents its architecture, camera and self-test, and `mockup/LEAD-NOTES.md` has the lead's notes and measurements.

## Ground rules

- Never push, add or change a remote, create a GitHub repository, or publish anything. Only the lead pushes, and only `main`. The owner decides when the repo goes public.
- Don't use `gh` or the GitHub API against this repo: the machine's `gh` is signed in to a different account.
- Work on your own branch and commit in small, descriptive steps. Don't change git config.
- Keep usernames, home-folder paths and account names out of files and commit messages. Always merge with an explicit message (`git merge -m "…"`), because git's default merge message includes the branch name.
- `mockup/` is the reference: read it, don't edit it.
- Stay honest. Real data is labelled real, the ABS truth is labelled as our reconstruction, and players, field and catch are illustrations. Never invent numbers, users or quotes.
- No MLB or team logos and no player likenesses. VR, sharing and leaderboards are out of scope.
- Credit the data: "MLB Stats API, © MLB Advanced Media, L.P.; individual, non-commercial use. Not affiliated with MLB."

## Code style

These are the owner's preferences. Lint should enforce the first two.

- Put a blank line after variable declarations, before the next statement.
- Put a blank line before a `return` that follows other statements.
- Comments must be earned: say why, not what. Don't write comments that restate the code.
- Use strict TypeScript. Keep the math (kinematics, ABS truth, lens fit, seeded RNG, stance, dealing) in pure modules with no DOM imports.

## Testing

- Every behaviour change comes with a test. The mockup's self-test guarantees stay as tests.
- Browser tests use Playwright. This machine is Windows 11 ARM64: if the bundled Chromium won't run, use the installed Edge (`channel: 'msedge'`). Test phones with device emulation, and use WebKit to stand in for Safari.
- Run browser tests on your own port: set `UE_E2E_PORT` to the port the lead gave you. Ports that browsers block, such as 4045 and 4190, are refused.
- Run one full e2e suite at a time on this machine: two at once overload it, and WebKit times out. Before a full run, check that no other session's test server is listening on ports 4173–4299, and wait if one is. While you work, run only the specs you touched.
- When an e2e test fails, read its `error-context.md` (the page snapshot at the failure) before you re-run anything, and list the failure in your report: test, project, step and error. A test that fails the same way twice, in any run, is a bug. Fix its cause; don't re-run it until it passes, and don't add retries or longer timeouts.
- When a test must allow an expected console error, match it by its exact source URL, assert how many times it happened, and keep failing on every other console or page error.
- When you fix a test, or add one that guards something (a cache, a rule, a budget), break the guarded thing locally and uncommitted, check that the test fails, then revert. Report which breaks it catches. Where the guarded cost is smaller than a frame, count the work instead of timing it.
- Run those breaks one at a time: break, run, revert, then the next. Don't start one while another run in the same worktree is still going, such as a background batch: two at once mix, and neither result holds.
- Anything that launches browsers takes the e2e lock, not just full suites: single specs, repeat runs and repro scripts too. `npm run e2e -- <specs or flags>` takes it and passes the rest to Playwright. `npx playwright test` doesn't take it, and a script takes it through `scripts/e2e-lock.ts`.
- When a run times out, or you stop it, kill its whole process tree (on Windows, `taskkill /T /F /PID <pid>`). Then check that none of its node, Playwright or browser processes survive: leftover runs load the machine, and WebKit then times out in everyone's tests.
- Data tests use small synthetic fixtures, not recorded MLB responses.

## Environment

- Windows 11 ARM64.
  - Node 26 and npm 11 in `C:\Program Files\nodejs`.
  - Git 2.56 at `C:\Program Files\Git\cmd\git.exe`.
  - Python 3.14 (arm64) and Edge are also installed.
- Windows PowerShell 5.1 has a Restricted execution policy, so run scripts with `-ExecutionPolicy Bypass`.
- npm here may resolve packages through a private registry mirror. The repo `.npmrc` keeps registry URLs out of `package-lock.json`. Never commit a lockfile whose `resolved` URLs point anywhere other than registry.npmjs.org.
- The MLB Stats API sometimes fails DNS for a moment. Retry.
