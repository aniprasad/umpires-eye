import type { PlayByPlay } from './mlb.ts';

// How one umpire_substitution event was read.
export type Reading =
  | 'takes-plate'
  | 'leaves-plate'
  | 'replaces-plate'
  | 'vacates-plate'
  | 'former-slot'
  | 'conflict'
  | 'base'
  | 'unreadable';

export interface UmpireEvent {
  atBat: number;
  afterPitch: number;
  text: string;
  reading: Reading;
}

// A stretch of the game with one plate umpire. It starts after event `event` of play `play` (positions in the play
// log); the first starts before the game. `called` counts the called pitches kept from it.
export interface PlateSpan {
  play: number;
  event: number;
  atBat: number;
  afterPitch: number;
  umpireId: number | null;
  called: number;
}

export interface PlateTrack {
  scheduledId: number | null;
  spans: PlateSpan[];
  events: UmpireEvent[];
  conflict: boolean;
  problems: string[];
}

const NO_UMPIRE = 'no umpire';
const CHANGE = /^Umpire change: (.+) replaces (?:([A-Z0-9]{2}) )?umpire (.+?)\.?$/;
const MOVE = /^Umpire (.+) moving to ([A-Z0-9]{2})\.?$/;

// The feed's text and the schedule spell names alike, but accents, initials and apostrophes are easy to lose.
export const normName = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// The plate umpire through a game: the one the schedule lists, then whatever the play log's umpire changes imply.
//
// The log writes "Umpire NAME moving to POS." and "Umpire change: NEW replaces [POS ]umpire OLD.", and the second is
// not literal. When OLD took the plate earlier in the same play, NEW fills OLD's former slot whatever POS says:
// "Erich Bacchus moving to HP." then "NO UMPIRE replaces HP umpire Erich Bacchus." leaves Bacchus at the plate and a
// base empty. That is an inference from the 2026 sequences, documented in docs/DATA.md. A change that puts someone
// other than the tracked plate umpire at the plate, or the plate umpire at a base, contradicts the schedule, so no one
// is named for the game up to that point.
export function trackPlateUmpire(pbp: PlayByPlay, scheduledId: number | null, names: ReadonlyMap<number, string>, gamePk: number): PlateTrack {
  const vacantId = (id: number): boolean => normName(names.get(id) ?? '') === NO_UMPIRE;
  const spans: PlateSpan[] = [
    { play: -1, event: -1, atBat: -1, afterPitch: 0, umpireId: scheduledId !== null && !vacantId(scheduledId) ? scheduledId : null, called: 0 },
  ];
  const events: UmpireEvent[] = [];
  const problems: string[] = [];
  let hp = spans[0]?.umpireId ?? null;
  let conflict = false;

  for (const [k, play] of (pbp.allPlays ?? []).entries()) {
    const atBat = play.atBatIndex ?? play.about?.atBatIndex ?? k;
    const tookPlate = new Set<string>();
    let pitches = 0;

    for (const [i, e] of (play.playEvents ?? []).entries()) {
      if (e.isPitch) pitches++;
      if (e.details?.eventType !== 'umpire_substitution') continue;

      const text = e.details.description ?? '';
      const id = e.umpire?.id ?? null;
      const where = `${gamePk}-${atBat}`;
      // The incoming umpire must be the one the text names, so an id never carries someone else's name.
      const put = (who: string | null): void => {
        let next: number | null = null;

        if (who !== null) {
          if (id !== null && normName(names.get(id) ?? '') === normName(who)) next = id;
          else problems.push(`${where}: "${text}" has umpire id ${id ?? 'none'}, which the schedule names ${(id !== null && names.get(id)) || 'no one'}`);
        }
        if (next !== hp) spans.push({ play: k, event: i, atBat, afterPitch: pitches, umpireId: next, called: 0 });
        hp = next;
      };
      const forget = (): void => {
        conflict = true;
        for (const s of spans) s.umpireId = null;
      };
      const plateName = hp === null ? null : normName(names.get(hp) ?? '');
      const change = CHANGE.exec(text);
      const move = change ? null : MOVE.exec(text);
      let reading: Reading;

      if (move) {
        const [, who = '', pos] = move;

        if (pos === 'HP') {
          put(who);
          tookPlate.add(normName(who));
          reading = 'takes-plate';
        } else if (id !== null && id === hp) {
          put(null);
          reading = 'leaves-plate';
        } else {
          reading = 'base';
        }
      } else if (change) {
        const [, incoming = '', pos, outgoing = ''] = change;
        const out = normName(outgoing);
        const vacant = normName(incoming) === NO_UMPIRE;

        if (tookPlate.has(out)) {
          reading = 'former-slot';
        } else if (pos === 'HP' || (pos === undefined && out === plateName)) {
          const contradicts = hp !== null && out !== plateName;

          if (contradicts) forget();
          put(vacant ? null : incoming);
          if (!vacant) tookPlate.add(normName(incoming));
          reading = contradicts ? 'conflict' : vacant ? 'vacates-plate' : 'replaces-plate';
        } else if (out === plateName) {
          forget();
          put(null);
          reading = 'conflict';
        } else {
          reading = 'base';
        }
      } else {
        problems.push(`${where}: unreadable umpire change "${text}"`);
        reading = 'unreadable';
      }
      events.push({ atBat, afterPitch: pitches, text, reading });
    }
  }

  return { scheduledId, spans, events, conflict, problems };
}

// The span a pitch at event `event` of play `play` falls in.
export function spanAt(track: PlateTrack, play: number, event: number): PlateSpan | undefined {
  let found = track.spans[0];

  for (const s of track.spans) {
    if (s.play > play || (s.play === play && s.event >= event)) break;
    found = s;
  }

  return found;
}

export interface PlateRun {
  atBat: number;
  afterPitch: number;
  umpireId: number | null;
  called: number;
}

// The game's plate umpires in order, with neighbouring spans of the same umpire merged.
export function plateRuns(track: PlateTrack): PlateRun[] {
  const runs: PlateRun[] = [];

  for (const s of track.spans) {
    const last = runs.at(-1);

    if (last && last.umpireId === s.umpireId) last.called += s.called;
    else runs.push({ atBat: s.atBat, afterPitch: s.afterPitch, umpireId: s.umpireId, called: s.called });
  }

  return runs;
}

// The plate changed hands, or the log left it unknown.
export const plateChanged = (track: PlateTrack): boolean => track.conflict || plateRuns(track).length > 1;
