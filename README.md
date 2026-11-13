# Umpire's Eye

Call real MLB pitches from the plate umpire's eye, at real speed. Then see the ABS truth, what the real umpire called, and your umpire card.

**Status:** in development, not published yet. The approved mockup lives in `mockup/`; open `mockup/index.html` in a browser to play it. The app in this repo is its production port: Vite and strict TypeScript, canvas 2D and plain DOM, no UI framework.

## Run it

You need Node 22.18 or later.

```sh
npm ci
npm run dev        # http://localhost:5173
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload. |
| `npm run build` | Production build into `dist/`. The site uses relative URLs, so it works from any folder. |
| `npm run preview` | Serves `dist/` at http://localhost:4173. |
| `npm run lint` | `check:lockfile`, then ESLint. ESLint enforces the house style: a blank line after declarations and before a `return` that follows other statements. |
| `npm run check:lockfile` | Fails if `package-lock.json` resolves any package outside registry.npmjs.org. |
| `npm run typecheck` | `tsc` in strict mode over the app, the tests and the configs, then `data:typecheck` over the data tools. |
| `npm test` | Vitest unit tests, including every check of the mockup's `?selftest=1`, then `data:test`, the data tools' tests. |
| `npm run e2e` | Playwright browser tests, one run at a time per machine (see below). It builds and serves the app itself. |
| `npm run assets` | Rebuilds the shipped images, fonts and pitch pool from the masters in `mockup/`. The output is committed, so you only need this when a master changes. |
| `npm run data:*` | The season dataset's tools: `fetch`, `build`, `validate`, `test` and `typecheck`. See `docs/DATA.md`. |

CI and the GitHub Pages deploy (`.github/workflows/`) are manual-only for now: they run only when someone starts them from the Actions tab.

### Browser tests

- `npx playwright install webkit` once, for the WebKit runs. Chromium-based runs use the installed Microsoft Edge (`channel: 'msedge'`), because Playwright's own Chromium doesn't run on Windows ARM64. CI on Linux uses Playwright's Chromium instead.
- Projects:
  - `desktop-edge` and `desktop-webkit`: a keyboard round, screenshots at 1440×900 and 1024×768, the self-test page, the depth-of-field checks and the failure states (pitch data or card art that won't load).
  - `iphone` (WebKit) and `pixel` (Edge): touch rounds in device emulation.
  - `parity`: screenshots the mockup and the port at the same URL states and writes `test-results/parity/report.md`. By default the mockup's footnotes take the height of the port's longer credit line, so the rest of the screen lines up. Set `UE_PARITY_ALIGN=0` to compare the pages untouched.
- Run one project with `npx playwright test --project=desktop-webkit`.
- Each run builds and serves its own copy on port 4173 and stops at once if that port is taken, so it never tests another checkout's server. Set `UE_E2E_PORT` (for example `UE_E2E_PORT=4191`) to run on another port, such as beside a running `npm run preview`; ports that browsers block, such as 4190, are refused.
- `npm run e2e` runs take turns on a machine, from any checkout, because two at once overload it. Each takes a lock file in the OS temp folder (`umpires-eye-e2e.lock`, with its pid, port and start time), waits while another live run holds it, logging every 30 s, and gives up after 20 minutes. A lock left by a run that died is taken over. The lock is skipped when `CI` is set, and `npx playwright test` doesn't take it.

## URL switches

| Query | Shows |
| --- | --- |
| `?state=pitch&i=3&t=0.2` | Pitch 3 of Today's Ten, frozen 0.2 s after release (`t` may be negative: the windup). |
| `?state=reveal&i=4&call=strike` | The reveal for pitch 4 after a strike call. |
| `?state=card&correct=8` | The umpire card for a round with 8 right. |
| `?selftest=1` | The self-test report. The page title becomes `SELFTEST PASS` or `SELFTEST FAIL`. |
| `?pool=ws` | The 2026 World Series pool. It's also the default for now; other values are ignored. |
| `?canvasFilter=fallback` | Draws the depth of field without the canvas `filter`, as WebKit does. |

## How it's built

- `src/core/`: pure TypeScript the app shares with the data tools: the rules, the seeded draws, the trajectory, the ABS rule and deal box, the season files' formats and their reader, the dealer, and the daily schedule's types, reserve rule and local dates. The tools run these files as they are under Node, so relative imports end in `.ts`. Lint and `src/core/tsconfig.json` keep core free of the DOM, Node, Vite and `Math.random`.
- `src/math/`: pure TypeScript with no DOM. Camera and lens fit, stance, depth of field, the batter, catcher, mitt framing, pitcher pose, mask clearance, dealing, and the reveal's wording.
- `src/data/`: the source contract a dataset implements (`source.ts`: Today's Ten for a date, the deck for Another ten, the lens points and the ump figure), the `?pool=` switch, and the 2026 World Series source (`public/data/ws-2026/pool.json`).
- `src/render/`: the scene. Static layers are painted once per stance, and the next pitch's are painted ahead. The ball, mitt, pitcher and reveal are drawn every frame. `filter.ts` draws every blur and colour grade, with a fallback for engines without canvas `filter`, such as Safari.
- `src/game/` and `src/ui/`: the flow (start, ten pitches, reveal, card), input, the HUD, the verdict panel and the card.
- `src/selftest/`: the mockup's self-test checks as pure functions. Vitest runs them, and so does `?selftest=1`.

## Assets

The masters stay in `mockup/assets/`, and `batter-src.png` is source art that never ships. The backdrop and batter keep full resolution, because the renderer's art metrics are in image pixels.

| Shipped file | Size | Master |
| --- | ---: | ---: |
| `backdrop-wide.webp` (1536×1024) | 97 KB | 2,070 KB PNG |
| `backdrop.webp` (fallback, 1536×1024) | 97 KB | 2,331 KB PNG |
| `batter.webp` (831×1445) | 96 KB | 1,027 KB PNG |
| `card-art-600.webp` / `card-art-1024.webp` | 81 / 325 KB | 3,506 KB PNG |
| Fonts (3 × WOFF2, OFL) | 64 KB | same |

## Data

Pitch data comes from the MLB Stats API, © MLB Advanced Media, L.P., for individual, non-commercial use. Umpire's Eye is free and isn't affiliated with or endorsed by MLB. The ABS zone it shows is our reconstruction. Players, field and catch are illustrations.

The fonts are Big Shoulders Display and Courier Prime, under the SIL Open Font License (`public/fonts/`).
