// The data tools' own settings: the game types they fetch and the download budget for a session. The units, the
// coordinates and the rules the app shares are in src/core/rules.ts.

export const GAME_TYPES = ['R', 'F', 'D', 'L', 'W'] as const;

export type GameType = (typeof GAME_TYPES)[number];

export const GAME_TYPE_NAMES: Record<GameType, string> = {
  R: 'Regular season',
  F: 'Wild Card Series',
  D: 'Division Series',
  L: 'League Championship Series',
  W: 'World Series',
};

export const SESSION_BUDGET_GZIP = 300_000;
/** A daily month file. */
export const MONTH_BUDGET_GZIP = 50_000;
/** What loads before Play is enabled: the manifest, the largest month file and stats. */
export const BOOT_BUDGET_GZIP = 50_000;
