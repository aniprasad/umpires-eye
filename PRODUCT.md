# Product

## Platform

web (phone and desktop browsers)

## Users

Baseball fans who follow closely. They lived through the first ABS-challenge season (2026) and argue balls and strikes from the couch. They come for a few minutes on a phone or laptop to test their eye.

## Product Purpose

Put the visitor behind the plate. Real MLB pitches fly in along their tracked flight path, at real speed, from the plate umpire's viewpoint. You call ball or strike, and then the truth is revealed: the ABS zone (our reconstruction of the zone MLB uses for challenges) and the call the real umpire made. Success is the "one more pitch" pull, and learning which locations fool you.

## Positioning

This isn't a stats chart with a dot. Each pitch is replayed from its tracked trajectory, seen through the ump's eyes, and graded against the 2026 ABS zone and against the human umpire who called it live. Hook: MLB umpires got 93.2% of calls right in 2026, but only 68.3% of the close ones. Can you?

## Operating Context

- Short rounds of 10 real pitches.
  - "Today's Ten" is chosen ahead of time by a script in this repo, for each date from November 1, 2026 to December 31, 2028, so everyone whose clock shows the same date gets the same ten, and it changes at local midnight. A date outside that range has none, and neither does a day that a later data rebuild made unavailable; the page offers Another ten instead.
  - "Another ten" deals a fresh set from the season, and never a pitch held back for a future Today's Ten. On one page, no pitch comes back until the page has dealt from all of the season's data, at least 3,430 tens; then it starts over.
- 2026 was MLB's first season with the ABS Challenge System, so fans know challenges, overturns and the height-based zone.
- Content: called pitches from the 2026 MLB season (regular season and postseason), from the MLB Stats API, built into a compact dataset by the data tools in this repo.

## Capabilities and Constraints

- Static site: no server and no accounts. It runs in phone and desktop browsers.
- Out of scope: VR, sharing and leaderboards.
- Truth is the ABS zone:
  - It's 17 in wide, with its top and bottom set by the batter's measured height (the feed's strikeZoneTop/Bottom, about 53.5% and 27% of it).
  - It's judged as the ball passes the middle of the plate. A pitch is a strike if any part of the ball touches the zone.
  - It's our reconstruction. It matched all 29 ABS challenges in the 2026 World Series, and 10,748 of the season's 10,749.
- The data is the MLB Stats API's, © MLB Advanced Media, L.P., under MLB's terms: "Only individual, non-commercial, non-bulk use of the Materials is permitted and any other use of the Materials is prohibited without prior written authorization from MLBAM." ([source](https://gdx.mlb.com/components/copyright.txt)). The app is free, non-commercial and credited, and isn't affiliated with MLB.
- No MLB or team logos and no player likenesses. Players, field and catch are illustrations.

## Evidence on Hand

- Real 2026 World Series data (all five games), validated: the ABS reconstruction matches 29 of 29 challenges, and the umps' original calls agree with it 92.0% of the time (683 of 742).
- The ump figures are our own: the umps' original calls agree with our ABS reconstruction on 93.24% of the season's 362,177 called pitches ("season overall"), and on 68.32% of the 59,910 within 1.5 in of the zone's edge ("on close calls") (`docs/DATA.md`). The app shows them to one decimal, at the start of a round and at its end: the hook gives both, and the card defines them. A player's score is set against the close-call figure, since eight of each ten's pitches are close calls. Other sites' accuracy numbers use their own zones and margins, so they aren't directly comparable.
- "~94%" comes from UmpScorecards, cited by mlb.com on 2026-02-05. Only the World Series pool, which keeps the design reference's wording, still shows it.
- There are no users, testimonials or usage numbers. Never invent leaderboards, player counts or quotes.

## Product Principles

1. The pitch is the hero: real flight, real speed, umpire's eye.
2. Commit, then reveal: you call it before you see the truth.
3. Honest truth: the ABS zone and the real call, never invented outcomes.
4. Teach, don't just score: show where you get fooled.
5. A few minutes, then something worth showing a friend.
