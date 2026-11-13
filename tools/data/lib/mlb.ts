// The parts of the MLB Stats API responses the pipeline reads. Everything is optional because the feed leaves fields
// out freely: untracked pitches, older records, games that never started.

export interface Ref {
  id: number;
  fullName?: string;
  link?: string;
}

export interface Code {
  code?: string;
  description?: string;
}

export interface Count {
  balls?: number;
  strikes?: number;
  outs?: number;
}

export interface ScheduleGame {
  gamePk: number;
  gameType?: string;
  season?: string;
  gameDate?: string;
  officialDate?: string;
  status?: { abstractGameState?: string; codedGameState?: string; detailedState?: string };
  teams?: { away?: { team?: Ref }; home?: { team?: Ref } };
  seriesDescription?: string;
  seriesGameNumber?: number;
  venue?: { id?: number; name?: string };
  // Only with hydrate=officials.
  officials?: Array<{ official?: Ref; officialType?: string }>;
}

export interface ScheduleResponse {
  dates?: Array<{ date?: string; games?: ScheduleGame[] }>;
}

export interface RawTeam {
  id: number;
  name?: string;
  abbreviation?: string;
}

export interface TeamsResponse {
  teams?: RawTeam[];
}

export interface RawPerson {
  id: number;
  fullName?: string;
  height?: string;
  primaryPosition?: { abbreviation?: string };
  batSide?: Code;
  pitchHand?: Code;
}

export interface PeopleResponse {
  people?: RawPerson[];
}

export interface Review {
  isOverturned?: boolean;
  inProgress?: boolean;
  reviewType?: string;
  challengeTeamId?: number;
  player?: Ref;
  additionalReviews?: Review[];
}

export interface Runner {
  movement?: {
    originBase?: string | null;
    start?: string | null;
    end?: string | null;
    outBase?: string | null;
    isOut?: boolean;
  };
  details?: { event?: string; eventType?: string; runner?: Ref; playIndex?: number };
}

export type CoordinateKey = 'x0' | 'y0' | 'z0' | 'vX0' | 'vY0' | 'vZ0' | 'aX' | 'aY' | 'aZ' | 'pX' | 'pZ';

export interface PitchData {
  startSpeed?: number;
  endSpeed?: number;
  strikeZoneTop?: number;
  strikeZoneBottom?: number;
  extension?: number;
  plateTime?: number;
  coordinates?: Partial<Record<CoordinateKey, number>>;
}

export interface PlayEvent {
  index?: number;
  pitchNumber?: number;
  isPitch?: boolean;
  type?: string;
  isSubstitution?: boolean;
  player?: Ref;
  replacedPlayer?: Ref;
  // On umpire_substitution events: the umpire who moves, or the one coming in. The feed gives no name here.
  umpire?: Ref;
  position?: { abbreviation?: string };
  count?: Count;
  details?: {
    call?: Code;
    code?: string;
    description?: string;
    event?: string;
    eventType?: string;
    type?: Code;
    awayScore?: number;
    homeScore?: number;
  };
  pitchData?: PitchData;
  reviewDetails?: Review;
}

export interface Play {
  atBatIndex?: number;
  about?: { atBatIndex?: number; halfInning?: string; isTopInning?: boolean; inning?: number };
  result?: { event?: string; awayScore?: number; homeScore?: number };
  count?: Count;
  matchup?: {
    batter?: Ref;
    batSide?: Code;
    pitcher?: Ref;
    pitchHand?: Code;
    postOnFirst?: Ref;
    postOnSecond?: Ref;
    postOnThird?: Ref;
  };
  runners?: Runner[];
  playEvents?: PlayEvent[];
  reviewDetails?: Review;
}

export interface PlayByPlay {
  allPlays?: Play[];
}
