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
| Game, team, venue, umpire and player names, scheduled start times, roster heights | Each pitch's plate umpire where the crew changed during the game, read from the play log's umpire changes (an inference, explained below) |
| | `dealable`, the pool and the shards |

## Sources

| Endpoint | Used for | Requests |
|---|---|---|
| `/api/v1/teams?sportId=1&season=2026` | Team abbreviations and names | 1 |
| `/api/v1/schedule?sportId=1&season=2026&gameType=…&hydrate=officials` | The completed games of each game type, with each game's scheduled start, venue and umpiring crew | 5 |
| `/api/v1/game/{gamePk}/playByPlay` | Pitches, tracking, calls, challenges, substitutions, runners, umpire changes | 2,469 |
| `/api/v1/people?personIds=…` (100 per request) | Batter heights, handedness, challengers' listed positions | 8 |

`playByPlay` is the smallest feed with everything per pitch (about 94 KB gzipped per game). `feed/live` would add the rosters but costs more. Heights come from `/people` instead. The start time, the venue and the crew come with the schedule, and the play log records changes to the crew, so none of them needs a request per game.

- A full fetch is 2,483 requests and about 263 MB over the wire. It covers 2,469 completed games (R 2,429, F 9, D 16, L 10, W 5) from 2026-03-25 to 2026-10-28, plus 799 players. One cancelled game is skipped.
- The fetcher is polite. It runs at most 4 requests at a time, asks for gzip, and retries with growing waits (the API's DNS sometimes fails for a moment).
- Raw responses are cached gzipped **outside the repo**, in `UE_CACHE_DIR` if it's set. Otherwise it's `%LOCALAPPDATA%\umpires-eye\mlb-cache` on Windows, and `$XDG_CACHE_HOME/umpires-eye/mlb-cache` or `~/.cache/umpires-eye/mlb-cache` elsewhere. The layout is `statsapi-v1/{teams,schedule,playByPlay,people}/…json.gz`.
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
- **Mid-plate-appearance changes.** A pitching change or pinch hitter between pitches hands the earlier pitches to the replaced player. There were 70 such substitutions (48 pitching changes, 22 pinch hitters) in 69 plate appearances.
  - Every pinch hitter's record names the batter he replaced, so 24 called pitches were credited to that batter.
  - None of the 48 pitching changes' records names the pitcher it replaced (no `replacedPlayer`). The 67 called pitches *before* them are marked uncertain and aren't dealable. None of them was challenged, so none is in the shards.
  - The description of each such change does name that pitcher ("Pitching Change: Jake Bird replaces Tim Hill."), but only in free text. Reading names out of text to recover 67 pitches isn't worth the risk of crediting the wrong pitcher, so they stay undealable.
- **Only the batter, the pitcher or the catcher may challenge**, so a fielding-team challenger who isn't the pitcher is the catcher. Some catchers' roster entries list another primary position: DH on 321 challenges, RF on 2.
- **A suspended game is listed as final twice.** 824912 began on 2026-06-16 and was finished the next day. Both listings have official date 2026-06-16; the build takes the earlier one, so the game keeps its original start.
- **One scoring error.** In plate appearance 824212-42, pitch 3 is coded a swinging strike at 0-2, so the feed's count reaches 0-3, yet the plate appearance ends in a walk. It's the only one in the season.
  - It gives two called pitches an impossible count before the pitch: `824212-42-5` at 0-3 and `824212-42-9` at 2-3.
  - By rule, a pitch whose count before it is impossible isn't dealable and stays out of the pool. Its call and tracking are fine, so it still counts in the season totals.
  - The report lists such pitches, and `data:validate` fails if a dealable pitch has an impossible count. These two are pinned in the integrity allowlist (see Validation).

### The plate umpire, pitch by pitch

The schedule lists each game's crew, and the play log records changes to it as `umpire_substitution` events: 39 of them in 16 games. Each event gives the id of the umpire who moves or comes in (`umpire.id`, with no name), and describes the change in one of two forms:

- "Umpire NAME moving to POS.", where POS is HP, 1B, 2B or 3B;
- "Umpire change: NEW replaces [POS ]umpire OLD.", where the position is sometimes left out and NEW can be "NO UMPIRE".

The build starts each game from the plate umpire the schedule lists and walks the events in order (`tools/data/lib/umpires.ts`):

1. "X moving to HP" puts X at the plate from that point, even in the middle of a plate appearance.
2. "NEW replaces HP umpire OLD", or "NEW replaces umpire OLD" when OLD is the plate umpire, puts NEW at the plate. If NEW is "NO UMPIRE", no one is named until someone takes the plate.
3. **Except** when OLD took the plate earlier in the same play. Then NEW fills OLD's former slot, whatever position the text gives, and the plate doesn't change.
4. A plate change that names someone other than the plate umpire on record, or that puts the plate umpire at a base, contradicts the schedule. No one is named for the game up to that point.

**Rule 3 is our inference from the order of the events, not something the feed states.**
- In four games the change right after an umpire moves "replaces" that same umpire. In 824600, 824874 and 824971 he moved to the plate: for example, "Umpire Erich Bacchus moving to HP." is followed by "Umpire change: NO UMPIRE replaces HP umpire Erich Bacchus." In 824195 he moved to first: "Umpire Willie Traynor moving to 1B." is followed by "Umpire change: NO UMPIRE replaces 1B umpire Willie Traynor."
- Read literally, the first three leave the plate empty in the middle of a game, and the fourth empties the base Traynor has just taken. Read as filling the slot each umpire left, all four leave the same three-umpire crew: plate, first and third, with second empty.
- 824398 has the same pattern with a real umpire. "Umpire Rob Drake moving to HP." is followed by "Umpire change: Steven Jaschinski replaces HP umpire Rob Drake." The build keeps Drake at the plate, and Jaschinski slides from second to Drake's old base at third: the same three-umpire crew. The literal reading would put Jaschinski at the plate and lose Drake altogether.
- Only the plate matters for the data, so the build applies rule 3 to umpires who took the plate; the base change in 824195 leaves the plate alone either way.

Each pitch stores its plate umpire in `umpire`. The names come from the schedule's crews, so an event whose id doesn't match the name in its text, or whose text the build can't read, fails the build. The plate changed hands in 10 games, and in one more the log contradicts the schedule:

| Game | Date | Scheduled (called pitches) | From | Then (called pitches) | How it was read |
|---|---|---|---|---|---|
| 823806 | 2026-04-01 | CB Bucknor (20) | PA 8, after pitch 6 | Chad Fairchild (121) | Rule 1 |
| 824289 | 2026-04-16 | Andy Fletcher (104) | PA 54 | Cory Blaser (48) | Rule 2: "Cory Blaser replaces umpire Andy Fletcher", with no position |
| 824195 | 2026-05-13 | Roberto Ortiz (86) | PA 49, after pitch 4 | Alex MacKay (72) | Rule 1 |
| 824600 | 2026-05-16 | Brian O'Nora (52) | PA 29, after pitch 1 | Erich Bacchus (93) | Rule 1, then rule 3 |
| 824334 | 2026-07-04 | Scott Barry (70) | PA 40 | Manny Gonzalez (72) | Rule 1 |
| 824971 | 2026-08-02 | Jeremie Rehak (93) | PA 43, after pitch 5 | Adam Beck (85) | Rule 1, then rule 3 |
| 824398 | 2026-08-18 | Jordan Baker (82) | PA 41 | Rob Drake (70) | Rule 1, then rule 3 |
| 824874 | 2026-08-29 | Ron Kulpa (94) | PA 52, after pitch 3 | Manny Gonzalez (39) | Rule 1, then rule 3 |
| 824473 | 2026-08-31 | Manny Gonzalez (79) | PA 37 | D.J. Reyburn (73) | Rule 1 |
| 824716 | 2026-09-01 | Will Little | | no one named (all 163) | Rule 4: "Ryan Wills moving to 2B." then "NO UMPIRE replaces HP umpire Ryan Wills." The log puts Wills at the plate where the schedule has Little, so the build names no one for the whole game |
| 824793 | 2026-09-07 | Chris Guccione (19) | PA 8, after pitch 4 | James Jean (128) | Rule 2: "James Jean replaces umpire Chris Guccione", with no position |

- The changes in the other five games (822886, 823569, 823867, 824426 and 824912) are among the base umpires.
- So 362,014 of the 362,177 called pitches name a plate umpire. The report lists every event with the rule it fell under.

## The ABS model

The model is the mockup's, unchanged. It matched 29 of 29 World Series challenges.

- **Zone:** 17 in wide (|x| ≤ 8.5 in). Top and bottom come from the feed's `strikeZoneTop`/`strikeZoneBottom`, which are 53.5% and 27% of the batter's height.
- **Where:** at mid-plate, y = 8.5/12 ft. The build re-integrates the feed's constant-acceleration fit, p(t) = p0 + v0·t + ½·a·t² with t = 0 at y0 = 50 ft, to find where the ball's centre crosses that plane.
- **Rule:** a strike if any part of the ball (radius 1.45 in) touches the zone. That is, the distance from the ball's centre to the zone rectangle is at most the radius, so the corners are rounded.
- **`marginIn`** = radius − signed distance from the ball's centre to the zone. It's how far the ball would have to move to flip the call: positive for strikes, negative for balls.
- **Dealable** means the app can deal the pitch without widening its lens, and can show it as it happened:
  - the mockup's rule: the mid-plate crossing has 0.9 < z < 4.5 ft and |x| < 1.5 ft (`DEAL_BOX`);
  - the release extension and speed are known, so it can be drawn;
  - it reaches the front of the plate within 0.6 s of release (`MAX_FLIGHT_S`). An eephus or a position player's lob arcs high and slow enough to leave the app's frame;
  - the batter and pitcher are certain;
  - the count before the pitch is a possible one.

The code is `src/core/kinematics.ts` and `src/core/abs.ts` (`tAtY`, `crossing`, `flightTime`, `absJudge`, `inDealBox`), which the app shares, and `tools/data/lib/judge.ts`. They're checked against the mockup's 742 pitches in `tools/data/test/mockup.test.ts`.

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
| **Mid-plate, r = 1.45 in, exact geometry (used)** | 337,685 (93.24%) | **10,748 (99.99%)** |
| Mid-plate, box rule (square corners) | 337,477 (93.18%) | 10,722 (99.75%) |
| Mid-plate, zone from roster height × 53.5% / 27% | 337,667 (93.23%) | 10,618 (98.78%) |
| Front of plate | 335,127 (92.53%) | 9,139 (85.02%) |
| Feed pX/pZ | 335,119 (92.53%) | 9,134 (84.98%) |
| Mid-plate, ball centre only (r = 0) | 327,285 (90.37%) | 7,054 (65.62%) |

**The zone.** The feed's zone is 53.5% and 27.0% of roster height at the median for all 660 batters. P1 to P99 is 53.14–53.87% for the top and 26.82–27.18% for the bottom, which is what rounding heights to whole inches allows.
- The feed gives 93 batters more than one zone during the season.
- The build uses the zone on each pitch, and that is what the challenges agree with.

**The umpires against our ABS call:**

| | Agree | Of | |
|---|---|---|---|
| All called pitches | 337,685 | 362,177 | 93.24% |
| Within 1.5 in of flipping | 40,933 | 59,910 | 68.32% |
| Within 4.5 in of flipping | 145,576 | 169,925 | 85.67% |
| After challenges (final calls) | 343,489 | 362,177 | 94.84% |

- "Within" is measured on the stored margin (0.01 in) here and everywhere else: the season totals, the pool and the app all classify a pitch the same way.
- Of the misses, 11,382 were true strikes called balls and 13,110 were true balls called strikes.
- By round, overall and within 1.5 in:
  - Regular season: 93.23% and 68.31%
  - Wild Card: 95.08% and 75.00%
  - Division Series: 93.45% and 68.63%
  - LCS: 93.28% and 68.93%
  - World Series: 92.05% and 63.41%
- Our 93.24% uses the ABS zone and rule above. Other sites' accuracy numbers use their own zones and margins, so they aren't directly comparable.

**Who challenged** (challenges, then how many were overturned):
- catchers: 5,738, 3,363 overturned (58.61%)
- batters: 4,831, 2,369 overturned (49.04%)
- pitchers: 180, 72 overturned (40.00%)

**Game state.** Each called pitch's count, outs, score and runners are rebuilt from the play log and checked against the feed:
- **Count:** the count after each called pitch equals the count before it plus the call. There were 0 mismatches in 362,177.
- **Outs:** the rebuilt outs equal the feed's on every pitch, with 0 mismatches.
- **Score:** it stays between the plate appearance's start and end, with 0 mismatches.
- **Runners:** the rebuilt runners equal the feed's `postOnFirst/Second/Third` after every plate appearance that didn't end the inning. There were 0 mismatches in 143,557.
- **Challenges:** all are placed. None is on an excluded pitch, none is orphaned, and none breaks the rule on who may challenge what.
- **Impossible counts:** 2 called pitches, both from the scoring error above. Neither is dealable.
- **Venues and umpires:** the schedule names a venue and a plate umpire for all 2,469 games. There are 34 venues and 91 plate umpires, and every umpire change in the play log reads cleanly.
- **Dealable pitches:** every one has a batter height and a pitch type.

**Integrity is enforced.** `data:build` and `data:validate` fail on any finding in these checks unless `ALLOWED` in `tools/data/lib/integrity.ts` pins it. Three are pinned, each checked by hand and described above:
- `824212-42-5` and `824212-42-9`, the impossible counts;
- `825000-30-3`, the one challenge our model calls the other way.

A pin that no longer matches anything is reported as stale. `data:validate` also judges the committed report's findings against the allowlist again.

**Release points.** Release x averages −1.89 ft for right-handers and +2.08 ft for left-handers. That fits +x pointing to first base.
- A few pitchers really do release a little across the middle. Braydon Fisher (R) is at +0.5 to +1.2 ft on 314 of his 661 called pitches.
- 23 pitches release 1.2–4.0 ft on the far side for their pitcher's listed hand. All 23 are uncertain pitches from before a pitching change whose record leaves out the pitcher it replaced, so they were probably thrown by the pitcher who left, not the one they're credited to. None of them is dealable.

**Slow pitches.** 793 called pitches take more than 0.6 s from release to the front of the plate:
- by pitch type: 543 eephus (EP), 150 fastballs (FA), 56 knuckleballs (KN), 13 curveballs, 10 sliders, 9 slow curves (CS), 6 changeups and 6 unknown (UN);
- 455 of them cross inside the deal box and would otherwise be dealable: 322 EP, 91 FA, 19 KN, 7 CS, 6 CU, 5 SL, 4 CH and 1 UN. By band, that's 76 close calls, 143 near, 72 between 4.5 and 6 in, and 164 clear;
- the slowest, `823798-73-1`, is a 30.3 mph eephus that takes 1.42 s. The slowest dealable pitch takes 0.5997 s.

These pitches still count in every season total; only dealing leaves them out.

**Stored precision.** Trajectories and zones are stored to 4 decimals and extension to 2. 7 pitches near an edge keep one more of each.
- Recomputing from the stored values always gives the stored ABS call, the deal box and the flight-time test.
- The recomputed margin is within 0.006 in of the stored one.

## Pool and shards

The app doesn't need every called pitch. A round of ten deals eight close calls, one near call and one calibrator, so the shards hold a pool in about those proportions:

| Part | Shipped | Season | Rule |
|---|---|---|---|
| Close | 59,810 | 59,810 | Every dealable pitch within 1.5 in of flipping |
| Near | 7,476 | 109,828 | Dealable, 1.5 to 4.5 in from flipping: one per eight close calls |
| Mid | 80 | 45,674 | Dealable, 4.5 to 6 in from flipping: only challenged ones, which the dealer never draws |
| Calibrators | 7,476 | 72,204 | Dealable clear calls, 6 in or more from flipping: one per eight close calls |
| Challenged | 10,749 | 10,749 | Every challenged pitch, dealable or not (10,744 are dealable); they're counted in the piles above too |
| **Pool** | **74,847** | | 74,842 dealable: close + near + mid + calibrators |

How to read the table:
- **Season** counts every dealable pitch in the band, challenged or not.
- **Shipped** counts every dealable pool pitch in the band, challenged ones included, because the dealer draws on those too. Sampling tops each pile up to its share: 3,976 near calls join the 3,500 challenged ones, and 7,470 calibrators join the 6 challenged clear calls.
- Every band is measured on the stored margin (0.01 in), which is what the app sees.
- 97 close and 185 near pitches pass the crossing rule but aren't dealable. 76 and 143 of them are too slow; the rest lack release data, have an uncertain batter or pitcher, or have an impossible count.

**Sampling.**
- The rates are a build parameter, `PER_CLOSE` in `tools/data/lib/pool.ts` (1/8 each). A different mix is a one-line change and a rebuild.
- Near calls and calibrators are each picked by seeded systematic sampling. The candidates are ordered by pitch type, then pitching team, then the order they were played. Every k-th one is taken from a seeded start.
- So every pitch type, and every team within it, keeps its share to within one pitch, and each one's picks are spread evenly through the season.

**Played order** is by date, then the game's scheduled start, then gamePk, then plate appearance and pitch. Doubleheaders therefore come in the order they were played. Other games on the same day follow their scheduled start, which can differ from the first pitch after a delay: 822839 was scheduled before 823893 but started after it. The suspended game 824912 sorts by its original start.

**Shards.** The pool is split into 22 shards of 3,402 or 3,403 pitches. Each shard is a fair sample of the season:
- Pitches are grouped by kind (close, near, calibrator, challenged by band), ABS call and batter side.
- Each group is shuffled with a seeded hash and dealt round robin, so every shard gets its share of each group to within one pitch.
- Within a shard, pitches are in played order.
- Each shard has 2,718–2,720 close calls (325 or 326 of them challenged), 339–341 near calls and 339 or 340 calibrators.

The build deals 200 rounds from every shard with the mockup's Today's Ten rule and fails if any shard can't deal a full ten. The rule:
- 1 calibrator;
- 8 pitches within 1.5 in, at least one of them challenged;
- 1 within 4.5 in;
- in played order.

**Sizes.** A play session downloads `manifest.json`, `stats.json` and one shard.

| File | Raw | Gzipped |
|---|---|---|
| One shard | 805–811 KB | 250–251 KB |
| `manifest.json` | about 11 KB | 4 KB |
| `stats.json` | about 3 KB | 1 KB |
| **One play session** | | **255 KB** (budget 300 KB) |
| All 22 shards | about 17.8 MB | about 5.5 MB |

The shard count comes from a fixed size (`PITCHES_PER_SHARD` = 3,500 in `tools/data/lib/pipeline.ts`), not from measured gzip size. Gzip output can differ between zlib builds, and the files must rebuild identically anywhere. The build fails if the largest session would exceed the budget.

## Format (version 1)

All files are UTF-8 JSON. Shards keep one row per line so diffs stay readable. Each file starts with `format`, `version`, `season`, `credit` and `truthNote`.

### `manifest.json` (`umpires-eye.season-manifest`)

| Key | Contents |
|---|---|
| `source`, `coverage` | Endpoints; game types, first and last date, games (and how many have a venue), called pitches (and how many name a plate umpire), challenges |
| `conventions` | Units, axes, trajectory, ABS rule, calls, `marginIn`, bases, games and played order, `umpire`, flags, ids, in words |
| `rules` | The numbers: ball radius, plate half-width, judging plane, `dealBox`, `maxFlightS`, close/near/calibrator bands |
| `gameTypes`, `teams`, `pitchTypes` | Names for codes; `pitchTypes` maps a code to `[name, family]` (fastball, breaking, offspeed or other) |
| `fields` | Column names for every shard table |
| `pool` | The composition above: shipped counts, `sampled` (what the sampler added), `sampledPerClose` (the rates) and `seasonDealable` (the season counts) |
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

Each shard is self-contained: its tables hold every game, venue, plate umpire and player its pitches mention.

Read columns by name from `fields`, not by position, so readers survive a later version that adds fields. `src/core/decode.ts`, which the app and the tools share, does this (`decodeGames`, `decodeNames`, `decodePlayers`, `decodePitches`). `decodeTables` reads a whole file: it checks the format and version, every cell against the field's type, that each pitch's game, players, plate umpire and pitch type, and each game's venue, are in their tables, and that no game, venue, umpire, player or pitch appears twice. It throws a `DecodeError` naming the table, row and field. `data:validate` reads every shard with it.

| Table | Fields |
|---|---|
| `games` | `gamePk`, `date` (the official date, YYYY-MM-DD), `start` (the scheduled start in ISO UTC, from the schedule's `gameDate`; a night game's falls on the next UTC day, as 823244's "2026-03-26T00:05:00Z" does on 2026-03-25), `gameType`, `away`, `home` (team abbreviations), `series` (e.g. "World Series", or null), `seriesGame`, `venue` (an id into `venues`, or null) |
| `venues` | `id`, `name` |
| `umpires` | `id`, `name`: every plate umpire the shard's pitches name |
| `players` | `id`, `name`, `heightIn` (roster height in inches, or null) |
| `pitches` | Below |

The games table is in played order. To order pitches drawn from several shards, sort by `date`, then `start`, then `gamePk`, `atBat` and `pitch`; the ISO strings sort as times.

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
| `umpire` | The plate umpire for this pitch, an id into `umpires`, or null where the play log leaves it unknown (only 824716). It follows mid-game changes, so it can differ between pitches of one game. |
| `type`, `mph` | Pitch type code (see `pitchTypes`) or null; release speed, or null |
| `x0` … `aZ` | The feed's 9-parameter fit in feet and seconds, with t = 0 at y0 ≈ 50 ft |
| `extension` | Release extension in feet, or null: release is at y = 60.5 − extension |
| `zoneTop`, `zoneBottom` | The batter's ABS zone in feet |
| `ump` | The umpire's original call: S or B |
| `final` | The call after any challenge: S or B |
| `abs` | Our ABS call: S or B |
| `marginIn` | Inches from flipping `abs`, to 0.01 in, positive for strikes. When it rounds to 0, `abs` decides. |
| `dealable` | 1 if the app may deal it, else 0 (see the model for the rule) |
| `challenge` | null, or `[by, team, role, overturned]`: the challenger's player id, team abbreviation, role (B batter, P pitcher, C catcher), and 1 if overturned |

Axes are the catcher's view: x across the plate (+x toward first base), y toward the pitcher (0 at the back tip of the plate, front edge at 17/12 ft), z up.

## Rebuilding

You need Node 22.18 or later (the scripts are TypeScript run with Node's type stripping). The scripts have no dependencies. Only `data:typecheck` needs `typescript` and `@types/node`, which `npm ci` installs with the app's dev dependencies.

```sh
npm run data:fetch     # once: downloads into the cache (about 2,500 requests, 263 MB)
npm run data:build     # about 15 s, reads only the cache, writes public/data/season-2026 and the report
npm run data:validate  # checks the files, then rebuilds from the cache and compares them byte for byte
npm run data:test      # unit tests for the math and parsers, with synthetic fixtures
npm run data:typecheck # strict TypeScript check of tools/data
```

- Set `UE_CACHE_DIR` to put the cache somewhere else.
- `npm run data:validate -- --no-rebuild` skips the rebuild comparison. Use it when there's no cache.
- The build is deterministic: the seed is `umpires-eye-2026`, and the files hold no timestamps or gzip sizes.
- To ship a different mix, change `PER_CLOSE` in `tools/data/lib/pool.ts`, or `PITCHES_PER_SHARD` in `tools/data/lib/pipeline.ts`, and rebuild.
- MLB sometimes corrects old games. A fetch into an empty cache months later may differ slightly from the committed dataset; `data:validate` will say so.
- If a rebuild meets a new integrity finding, the build stops and names it. Check it by hand, then either fix the parser or pin it in `ALLOWED` in `tools/data/lib/integrity.ts` and describe it here.

The code lives in `tools/data/`, and in `src/core/`, which it shares with the app:
- `fetch.ts`, `build.ts` and `validate.ts`.
- `lib/`, which has:
  - `plays.ts`: parse the play log and rebuild the game state;
  - `umpires.ts`: follow the plate umpire through the play log's umpire changes;
  - `judge.ts`: the ABS model and the dealing rules for each pitch;
  - `pool.ts`: pool and shards;
  - `format.ts`: writing the files;
  - `integrity.ts`: the allowlist and the per-pitch checks `data:validate` runs;
  - `stats.ts`: totals and the validation report;
  - `pipeline.ts`: the build.
- `src/core/`: the rules (`rules.ts`), the seeded draws (`rng.ts`), the trajectory (`kinematics.ts`), the ABS rule and deal box (`abs.ts`), the file formats, field lists and the types of the shard, manifest and stats files (`schema.ts`) with their reader (`decode.ts`), the round of ten (`deal.ts`), which deals only rows whose stored `dealable` flag is set, and the daily schedule (`daily.ts`): the month file's types, the daily reserve and local dates. The tools import these files as they are, under Node; `lib/constants.ts` keeps only the tools' own settings.
