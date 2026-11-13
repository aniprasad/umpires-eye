# Product

<!-- impeccable:product-schema 1 -->

## Platform

web (phone and desktop browsers)

## Users

Baseball fans who follow closely. They lived through the first ABS-challenge season (2026) and argue balls and strikes from the couch. They come for a few minutes on a phone or laptop to test their eye. *(Inferred from the brainstorm; the owner confirmed the "be the ump" version on 2026-11-12.)*

## Product Purpose

Put the visitor behind the plate. Real MLB pitches fly in along their tracked flight path, at real speed, from the plate umpire's viewpoint. You call ball or strike, and then the truth is revealed: the ABS zone (our reconstruction of the zone MLB uses for challenges) and the call the real umpire made. Success is the "one more pitch" pull, and learning which locations fool you.

## Positioning

This isn't a stats chart with a dot. Each pitch is replayed from its tracked trajectory, seen through the ump's eyes, and graded against the 2026 ABS zone and against the human umpire who called it live. Hook: MLB umps call about 94% of pitches correctly. Can you?

## Operating Context

- Short rounds of 10 real pitches. "Today's Ten" is the same for everyone each day; "Another ten" deals a fresh set.
- 2026 was MLB's first season with the ABS Challenge System, so fans know challenges, overturns and the height-based zone.
- Content: called pitches from the 2026 MLB season (regular season and postseason), from the MLB Stats API. They're bundled with the app as a compact dataset built by a script in this repo.

## Capabilities and Constraints

- Static site: no server and no accounts. It runs in phone and desktop browsers.
- Out of scope (owner's call): VR, sharing and leaderboards.
- Truth is the ABS zone:
  - It's 17 in wide, with its top and bottom set by the batter's measured height (the feed's strikeZoneTop/Bottom, about 53.5% and 27% of it).
  - It's judged as the ball passes the middle of the plate. A pitch is a strike if any part of the ball touches the zone.
  - It's our reconstruction. It matched all 29 ABS challenges in the 2026 World Series.
- Data credit: MLB Stats API, © MLB Advanced Media, L.P., for individual, non-commercial use.
  - The app is free, non-commercial and credited, and isn't affiliated with MLB.
  - Whether the dataset is published, in the public repo or on the Pages site, is decided at publish time. The first Pages run publishes it.
- No MLB or team logos and no player likenesses. Players, field and catch are illustrations.

## Evidence on Hand

- Real 2026 World Series data (all five games), validated: the ABS reconstruction matches 29 of 29 challenges, and the umps' original calls agree with it 92.0% of the time (683 of 742).
- "~94%" comes from UmpScorecards, cited by mlb.com on 2026-02-05. The season dataset will let us state our own number.
- There are no users, testimonials or usage numbers. Never invent leaderboards, player counts or quotes.

## Product Principles

1. The pitch is the hero: real flight, real speed, umpire's eye.
2. Commit, then reveal: you call it before you see the truth.
3. Honest truth: the ABS zone and the real call, never invented outcomes.
4. Teach, don't just score: show where you get fooled.
5. A few minutes, then something worth showing a friend.
