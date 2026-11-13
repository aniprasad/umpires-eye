# Umpire's Eye: season data

`public/data/season-2026/` holds every called pitch of the 2026 MLB season that the game can deal, each judged against our reconstruction of the ABS zone. It covers the regular season and the postseason (game types R, F, D, L and W).

The files are built by a script in this repo (`tools/data/`) from the MLB Stats API. The build is reproducible: the same cached responses always give byte-identical files.

## Credit and terms

- Data: **MLB Stats API, © MLB Advanced Media, L.P.; individual, non-commercial use. Not affiliated with MLB.** Every file carries this line in its `credit` field.
- Each API response says: "Copyright 2026 MLB Advanced Media, L.P. Use of any content on this page acknowledges agreement to the terms posted here http://gdx.mlb.com/components/copyright.txt".
- Umpire's Eye is a free, non-commercial fan project. It isn't affiliated with or endorsed by MLB or any team, and it uses no logos or player likenesses.
- Whether the dataset goes into the public repo is decided at publish time. Anyone can rebuild it with the steps below.

What is real and what is ours:

| Real, from the feed | Ours, computed by the build |
|---|---|
| Final calls, challenges and their outcomes | `abs`, the ABS call, and `marginIn` (our reconstruction, **not MLB's official ABS output**) |
| The 9-parameter trajectory fit, speed, extension | The umpire's original call on overturned pitches (the opposite of the final call) |
| The batter's ABS zone (`strikeZoneTop`/`Bottom`) | The game state before each pitch (rebuilt from the play log, then cross-checked against the feed) |
| Game, team, venue, plate umpire and player names, roster heights | `dealable`, the pool and the shards |

## Sources

| Endpoint | Used for | Requests |
|---|---|---|
| `/api/v1/teams?sportId=1&season=2026` | Team abbreviations and names | 1 |
| `/api/v1/schedule?sportId=1&season=2026&gameType=…&hydrate=officials` | The completed games of each game type, with each game's venue and umpiring crew | 5 |
| `/api/v1/game/{gamePk}/playByPlay` | Pitches, tracking, calls, challenges, substitutions, runners | 2,469 |
| `/api/v1/people?personIds=…` (100 per request) | Batter heights, handedness, challengers' listed positions | 8 |

`playByPlay` is the smallest feed with everything per pitch (about 94 KB gzipped per game). `feed/live` would add the rosters but costs more. Heights come from `/people` instead. The venue and the plate umpire come with the schedule, so they need no requests per game.

- A full fetch is 2,483 requests and about 263 MB over the wire. It covers 2,469 completed games (R 2,429, F 9, D 16, L 10, W 5) from 2026-03-25 to 2026-10-28, plus 799 players. One cancelled game is skipped.
- The fetcher is polite. It runs at most 4 requests at a time, asks for gzip, and retries with growing waits (the API's DNS sometimes fails for a moment).
- Raw responses are cached gzipped **outside the repo**, in `UE_CACHE_DIR` or by default `%LOCALAPPDATA%\umpires-eye\mlb-cache`. The layout is `statsapi-v1/{teams,schedule,playByPlay,people}/…json.gz`.
  - Anything cached is never fetched again, so reruns and other worktrees share one download.
  - Delete the folder to start fresh.

## What counts as a called pitch

A called pitch is a pitch event (`isPitch`) whose `details.call.code` is `B` (ball) or `C` (called strike) and that has full tracking: all 9 trajectory parameters and the zone. That gives **362,177** called pitches.

Left out:

| What | Count | Why |
|---|---|---|
| `*B`, ball in the dirt | 15,142 | Nobody needs an eye to call these; the mockup leaves them out too |
| Called pitches without tracking | 192 | No trajectory or zone to judge |
| Automatic balls and strikes | 2,347 | Pitch-clock and timeout violations and intentional balls are `no_pitch` events, not pitches. They still move the count, which the build keeps. |

### Feed quirks the build handles

The quirks found on the World Series (`mockup/data/DATA.md`) all hold for the full season:

- **`details.call` is the final call, after any challenge.** When a challenge was overturned, the umpire's original call is the opposite.
- **Challenges are `reviewType` `MJ`** (team challenge, pitch result).
  - Most are on the pitch event: 8,049 of 10,749.
  - The other 2,700 appear only on the play record. As in the World Series, the build gives them to the plate appearance's last pitch.
- **pX/pZ are at the front of the plate, not mid-plate.** Our front-plane crossing reproduces them to 0.0025 in at the median (0.0097 in at P99). At mid-plate the gap is 0.98 in at the median.
- **A pitch event's `count.outs` is the outs before the pitch.**

New on the full season:

- **The extra-innings runner** is placed by a `runner_placed` action event ("… starts inning at 2nd base"). He shows up in `runners[]` only if he later moves.
- **Pinch runners** come in through an `offensive_substitution` event with position `PR` that names the player replaced. They often enter before the next plate appearance's first pitch.
- **Mid-plate-appearance changes.** A pitching change or pinch hitter between pitches hands the earlier pitches to the replaced player. That happened in 70 plate appearances.
  - 24 pitches were credited to the replaced player.
  - 67 pitches came after a change that doesn't say who was replaced. They're marked uncertain and aren't dealable.
- **Only the batter, the pitcher or the catcher may challenge**, so a fielding-team challenger who isn't the pitcher is the catcher. Some catchers' roster entries list another primary position: DH on 321 challenges, RF on 2.
- **One scoring error.** In plate appearance 824212-42, pitch 3 is coded a swinging strike at 0-2, so the feed's count reaches 0-3, yet the plate appearance ends in a walk. It's the only one in the season.
  - It gives two called pitches an impossible count before the pitch: `824212-42-5` at 0-3 and `824212-42-9` at 2-3.
  - By rule, a pitch whose count before it is impossible isn't dealable and stays out of the pool. Its call and tracking are fine, so it still counts in the season totals.
  - The report lists such pitches, and `data:validate` fails if a dealable pitch has an impossible count.

## The ABS model

The model is the mockup's, unchanged. It matched 29 of 29 World Series challenges.

- **Zone:** 17 in wide (|x| ≤ 8.5 in). Top and bottom come from the feed's `strikeZoneTop`/`strikeZoneBottom`, which are 53.5% and 27% of the batter's height.
- **Where:** at mid-plate, y = 8.5/12 ft. The build re-integrates the feed's constant-acceleration fit, p(t) = p0 + v0·t + ½·a·t² with t = 0 at y0 = 50 ft, to find where the ball's centre crosses that plane.
- **Rule:** a strike if any part of the ball (radius 1.45 in) touches the zone. That is, the distance from the ball's centre to the zone rectangle is at most the radius, so the corners are rounded.
- **`marginIn`** = radius − signed distance from the ball's centre to the zone. It's how far the ball would have to move to flip the call: positive for strikes, negative for balls.
- **Dealable** means the app can deal the pitch without widening its lens, and can show it as it happened:
  - the mockup's rule: the mid-plate crossing has 0.9 < z < 4.5 ft and |x| < 1.5 ft;
  - the release extension and speed are known, so it can be drawn;
  - the batter and pitcher are certain;
  - the count before the pitch is a possible one.

The code is `tools/data/lib/physics.ts` (`tAtY`, `crossing`, `absJudge`, `isDealable`), checked against the mockup's 742 pitches in `tools/data/test/mockup.test.ts`.

## Validation

`npm run data:build` writes the full report to `tools/data/reports/season-2026.json`.

**Challenges.** There were 10,749, and 5,804 of them were overturned. **Our ABS call equals the final call on 10,748 of 10,749 (99.99%).**

The one exception is `825000-30-3` (2026-05-30):
- Tyler Soderstrom (L) challenged a called strike at 2-0 on a slider from Ryan Weathers (L), and the call was upheld.
- We call it a ball by 0.76 in. At mid-plate the ball's centre is 2.2 in below the bottom of the zone, at the outside edge of the plate.
- Judged at the front of the plate it would be a strike by 0.41 in. With a zone from roster height it would still be a ball by 0.85 in.
- We left the model alone because it matches every other challenge. A single disagreement this size could come from tracking that was revised after the review, but the feed doesn't say.

How the result changes with the method:

| Method | Agrees with the ump's original call | Challenges matched |
|---|---|---|
| **Mid-plate, r = 1.45 in, exact geometry (used)** | 337,685 (93.2%) | **10,748 (99.99%)** |
| Mid-plate, box rule (square corners) | 337,477 (93.2%) | 10,722 (99.7%) |
| Mid-plate, zone from roster height × 53.5% / 27% | 337,667 (93.2%) | 10,618 (98.8%) |
| Front of plate | 335,127 (92.5%) | 9,139 (85.0%) |
| Feed pX/pZ | 335,119 (92.5%) | 9,134 (85.0%) |
| Mid-plate, ball centre only (r = 0) | 327,285 (90.4%) | 7,054 (65.6%) |

**The zone.** The feed's zone is 53.5% and 27.0% of roster height at the median for all 660 batters. P1 to P99 is 53.14–53.87% for the top and 26.82–27.18% for the bottom, which is what rounding heights to whole inches allows.
- The feed gives 93 batters more than one zone during the season.
- The build uses the zone on each pitch, and that is what the challenges agree with.

**The umpires against our ABS call:**

| | Agree | Of | |
|---|---|---|---|
| All called pitches | 337,685 | 362,177 | 93.2% |
| Within 1.5 in of flipping | 40,763 | 59,706 | 68.3% |
| Within 4.5 in of flipping | 145,429 | 169,778 | 85.7% |
| After challenges (final calls) | 343,489 | 362,177 | 94.8% |

- Of the misses, 11,382 were true strikes called balls and 13,110 were true balls called strikes.
- By round, overall and within 1.5 in:
  - Regular season: 93.2% and 68.3%
  - Wild Card: 95.1% and 74.5%
  - Division Series: 93.5% and 68.6%
  - LCS: 93.3% and 68.9%
  - World Series: 92.0% and 63.4%
- Our 93.2% uses the ABS zone and rule above. Other sites' accuracy numbers use their own zones and margins, so they aren't directly comparable.

**Who challenged** (challenges, then how many were overturned):
- catchers: 5,738, 3,363 overturned (58.6%)
- batters: 4,831, 2,369 overturned (49.0%)
- pitchers: 180, 72 overturned (40.0%)

**Game state.** Each called pitch's count, outs, score and runners are rebuilt from the play log and checked against the feed:
- **Count:** the count after each called pitch equals the count before it plus the call. There were 0 mismatches in 362,177.
- **Outs:** the rebuilt outs equal the feed's on every pitch, with 0 mismatches.
- **Score:** it stays between the plate appearance's start and end, with 0 mismatches.
- **Runners:** the rebuilt runners equal the feed's `postOnFirst/Second/Third` after every plate appearance that didn't end the inning. There were 0 mismatches in 143,557.
- **Challenges:** all are placed. None is on an excluded pitch, none is orphaned, and none breaks the rule on who may challenge what.
- **Impossible counts:** 2 called pitches, both from the scoring error above. Neither is dealable.
- **Venues and plate umpires:** the schedule names both for all 2,469 games. There are 34 venues and 91 plate umpires.

**Release points.** Release x averages −1.89 ft for right-handers and +2.08 ft for left-handers. That fits +x pointing to first base.
- A few pitchers really do release a little across the middle. Braydon Fisher (R) is at +0.5 to +1.2 ft on 314 of his 661 called pitches.
- 23 pitches from 15 pitchers, each within a single game, release 1.2–4.0 ft on the other side of their listed hand. They may be tracking glitches, and they're left as they are.

**Stored precision.** Trajectories and zones are stored to 4 decimals; 8 pitches near an edge keep 5.
- Recomputing the ABS call from the stored values always gives the stored call and `dealable` flag.
- The recomputed margin is within 0.006 in of the stored one.

## Pool and shards

The app doesn't need every called pitch. A round of ten deals eight close calls, one near call and one calibrator, so the shards hold a pool in about those proportions:

| Part | Shipped | Season | Rule |
|---|---|---|---|
| Close | 59,886 | 59,886 | Every dealable pitch within 1.5 in of flipping |
| Near | 7,486 | 109,971 | Dealable, 1.5 to 4.5 in from flipping: one per eight close calls |
| Calibrators | 7,480 | 72,368 | Dealable clear calls, 6 in or more from flipping: one per eight close calls |
| Challenged | 10,749 | 10,749 | Every challenged pitch, dealable or not (10,744 are dealable) |
| **Pool** | **74,943** | | 74,938 dealable |

How to read the table:
- **Season** counts every dealable pitch in the band, challenged or not.
- **Shipped** close and near counts include challenged pitches. The dealer draws on those too, so they count toward each pile's share: the 3,519 challenged near calls are part of the 7,486.
- The calibrator pile also holds the 6 challenged clear calls.
- Close, near and clear are measured on the stored margin (0.01 in), which is what the app sees.
- 21 close and 42 near pitches pass the crossing rule but can't be shown (missing release data, or an uncertain batter or pitcher), so they're left out.

**Sampling.**
- The rates are a build parameter, `PER_CLOSE` in `tools/data/lib/pool.ts` (1/8 each). A different mix is a one-line change and a rebuild.
- Near calls and calibrators are each picked by seeded systematic sampling. The candidates are ordered by pitch type, then pitching team, then the order they were played. Every k-th one is taken from a seeded start.
- So every pitch type, and every team within it, keeps its share to within one pitch, and each one's picks are spread evenly through the season.

**Shards.** The pool is split into 22 shards of 3,406 or 3,407 pitches. Each shard is a fair sample of the season:
- Pitches are grouped by kind (close, near, calibrator, challenged by band), ABS call and batter side.
- Each group is shuffled with a seeded hash and dealt round robin, so every shard gets its share of each group to within one pitch.
- Within a shard, pitches are in played order.
- Each shard has 2,721–2,723 close calls (325 or 326 of them challenged), 340 or 341 near calls and 340 or 341 calibrators.

The build deals 200 rounds from every shard with the mockup's Today's Ten rule and fails if any shard can't deal a full ten. The rule:
- 1 calibrator;
- 8 pitches within 1.5 in, at least one of them challenged;
- 1 within 4.5 in;
- in played order.

**Sizes.** A play session downloads `manifest.json`, `stats.json` and one shard.

| File | Raw | Gzipped |
|---|---|---|
| One shard | 754–760 KB | 243–244 KB |
| `manifest.json` | about 10 KB | 4 KB |
| `stats.json` | about 3 KB | 1 KB |
| **One play session** | | **248 KB** (budget 300 KB) |
| All 22 shards | about 16.6 MB | about 5.4 MB |

The shard count comes from a fixed size (`PITCHES_PER_SHARD` = 3,500 in `tools/data/lib/pipeline.ts`), not from measured gzip size. Gzip output can differ between zlib builds, and the files must rebuild identically anywhere. The build fails if the largest session would exceed the budget.

## Format (version 1)

All files are UTF-8 JSON. Shards keep one row per line so diffs stay readable. Each file starts with `format`, `version`, `season`, `credit` and `truthNote`.

### `manifest.json` (`umpires-eye.season-manifest`)

| Key | Contents |
|---|---|
| `source`, `coverage` | Endpoints; game types, first and last date, games (and how many have a venue and a plate umpire), called pitches, challenges |
| `conventions` | Units, axes, trajectory, ABS rule, calls, `marginIn`, bases, game ids, flags, ids, in words |
| `rules` | The numbers: ball radius, plate half-width, judging plane, dealable box, close/near/calibrator bands |
| `gameTypes`, `teams`, `pitchTypes` | Names for codes; `pitchTypes` maps a code to `[name, family]` (fastball, breaking, offspeed or other) |
| `fields` | Column names for every shard table |
| `pool` | The composition above: shipped counts, `sampledPerClose` (the rates) and `seasonDealable` (the season counts) |
| `session` | The download budget |
| `shards[]` | `file`, `pitches`, `dealable`, `bytes`, `sha256` for each shard |

### `stats.json` (`umpires-eye.season-stats`)

Season totals over all 362,177 called pitches, not just the pool:
- `games` and `calledPitches`, by game type;
- `excluded`;
- `challenges`, by role, with `absAgreesWithFinalCall`;
- `umpVsAbs`: overall, within 1.5 in, within 4.5 in, after challenges, and the two kinds of miss;
- `umpVsAbsByGameType`.

### `shards/NN.json` (`umpires-eye.season-shard`)

Besides the common head, a shard has:
- `shard` and `shards`;
- `fields` (the same as the manifest's);
- `pitchTypes`;
- five tables of rows: `games`, `venues`, `umpires`, `players` and `pitches`.

Each shard is self-contained: its tables hold every game, venue, umpire and player its pitches mention.

Read columns by name from `fields`, not by position, so readers survive a later version that adds fields. `tools/data/lib/decode.ts` does this (`decodeGames`, `decodeNames`, `decodePitches`).

| Table | Fields |
|---|---|
| `games` | `gamePk`, `date` (YYYY-MM-DD), `gameType`, `away`, `home` (team abbreviations), `series` (e.g. "World Series", or null), `seriesGame`, `venue` and `umpire` (ids into the next two tables, or null) |
| `venues` | `id`, `name` |
| `umpires` | `id`, `name`: the plate umpire the schedule lists for the game |
| `players` | `id`, `name`, `heightIn` (roster height in inches, or null) |
| `pitches` | Below |

Pitch fields, all describing the moment before the pitch:

| Field | Meaning |
|---|---|
| `gamePk`, `atBat`, `pitch` | The id is `gamePk-atBat-pitch` |
| `inning`, `top` | `top` is 1 for the top half, 0 for the bottom |
| `outs`, `balls`, `strikes` | Before the pitch |
| `awayScore`, `homeScore` | Before the pitch |
| `bases` | Occupied bases before the pitch, as a bitmask: 1 = first, 2 = second, 4 = third |
| `batter`, `bats` | Player id; L or R for this plate appearance |
| `pitcher`, `throws` | Player id; L or R |
| `type`, `mph` | Pitch type code (see `pitchTypes`) or null; release speed, or null |
| `x0` … `aZ` | The feed's 9-parameter fit in feet and seconds, with t = 0 at y0 ≈ 50 ft |
| `extension` | Release extension in feet, or null: release is at y = 60.5 − extension |
| `zoneTop`, `zoneBottom` | The batter's ABS zone in feet |
| `ump` | The umpire's original call: S or B |
| `final` | The call after any challenge: S or B |
| `abs` | Our ABS call: S or B |
| `marginIn` | Inches from flipping `abs`, to 0.01 in, positive for strikes. When it rounds to 0, `abs` decides. |
| `dealable` | 1 if the app may deal it, else 0 |
| `challenge` | null, or `[by, team, role, overturned]`: the challenger's player id, team abbreviation, role (B batter, P pitcher, C catcher), and 1 if overturned |

Axes are the catcher's view: x across the plate (+x toward first base), y toward the pitcher (0 at the back tip of the plate, front edge at 17/12 ft), z up.

## Rebuilding

You need Node 22.18 or later (the scripts are TypeScript run with Node's type stripping). The scripts have no dependencies; only the typecheck needs the repo's `typescript` and `@types/node`.

```sh
npm run data:fetch     # once: downloads into the cache (about 2,500 requests, 263 MB)
npm run data:build     # about 15 s, reads only the cache, writes public/data/season-2026 and the report
npm run data:validate  # checks the files, then rebuilds from the cache and compares them byte for byte
npm run data:test      # unit tests for the math and parsers, with synthetic fixtures
npm run data:typecheck # strict TypeScript check of tools/data
```

- Set `UE_CACHE_DIR` to put the cache somewhere else.
- `data:validate --no-rebuild` skips the rebuild comparison. Use it when there's no cache.
- The build is deterministic: the seed is `umpires-eye-2026`, and the files hold no timestamps or gzip sizes.
- To ship a different mix, change `PER_CLOSE` in `tools/data/lib/pool.ts`, or `PITCHES_PER_SHARD` in `tools/data/lib/pipeline.ts`, and rebuild.
- MLB sometimes corrects old games. A fetch into an empty cache months later may differ slightly from the committed dataset; `data:validate` will say so.

The code lives in `tools/data/`:
- `fetch.ts`, `build.ts` and `validate.ts`.
- `lib/`, which has:
  - `plays.ts`: parse the play log and rebuild the game state;
  - `physics.ts` and `judge.ts`: the ABS model;
  - `pool.ts`: pool and shards;
  - `deal.ts`: the Today's Ten rule;
  - `format.ts` and `decode.ts`: the files;
  - `stats.ts`: totals and the validation report;
  - `pipeline.ts`: the build.
