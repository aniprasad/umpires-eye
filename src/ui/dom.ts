export function $<T extends Element = HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);

  if (!el) throw new Error(`Missing element ${sel}`);

  return el;
}

export const UI = {
  app: $('#app'),
  scene: $<HTMLCanvasElement>('#scene'),
  live: $('#live'),
  start: $('#start'),
  hook: $('#hook'),
  btnPlay: $<HTMLButtonElement>('#btnPlay'),
  slow: $('#slowHint'),
  startLede: $('#startLede'),
  figCite: $('#figCite'),
  matchup: $('#matchup'),
  muInning: $('#muInning'),
  muOuts: $('#muOuts'),
  muBases: $<SVGSVGElement>('#muBases'),
  muScore: $('#muScore'),
  muBatter: $('#muBatter'),
  muBatterMeta: $('#muBatterMeta'),
  muPitcher: $('#muPitcher'),
  muPitcherMeta: $('#muPitcherMeta'),
  muGame: $('#muGame'),
  score: $('#scoreChip'),
  scMain: $('#scMain'),
  scSub: $('#scSub'),
  wB: $('#wB'),
  wS: $('#wS'),
  wO: $('#wO'),
  indPitch: $('#indPitch'),
  indClock: $('#indClock'),
  indText: $('#indText'),
  indicator: $('#indicator'),
  btnBall: $<HTMLButtonElement>('#btnBall'),
  btnStrike: $<HTMLButtonElement>('#btnStrike'),
  btnReplay: $<HTMLButtonElement>('#btnReplay'),
  btnNext: $<HTMLButtonElement>('#btnNext'),
  nextLabel: $('#nextLabel'),
  verdict: $('#verdict'),
  vUmp: $('#vUmp'),
  vLine: $('#vLine'),
  vCtx: $('#vCtx'),
  vMeta: $('#vMeta'),
  vScore: $('#vScore'),
  toast: $('#toast'),
  err: $('#err'),
  selftest: $('#selftest'),
};

export const CARD = {
  root: $('#cards'),
  sum: $('#cardsSum'),
  num: $('#ucNum'),
  art: $<HTMLImageElement>('#ucArt'),
  caption: $('#ucSet'),
  set: $('#ubSet'),
  pitches: $('#ubPitches'),
  correct: $('#ubCorrect'),
  ump: $('#ubUmp'),
  figRow: $('#ubFigRow'),
  figLabel: $('#ubFigLabel'),
  fig: $('#ubFig'),
  tough: $('#ubTough'),
  map: $<SVGSVGElement>('#ubMap'),
  foot: $('#ubFoot'),
  copy: $<HTMLButtonElement>('#btnCopy'),
  again: $<HTMLButtonElement>('#btnAgain'),
};

/** The error surface: never silent. */
export function fail(msg: string): void {
  UI.err.hidden = false;
  UI.err.textContent += msg + '\n';
}
