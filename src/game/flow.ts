import { dateKeyOf } from '../core/daily.ts';
import { prep } from '../math/kinematics';
import { dateLabel } from '../data/dates';
import { LoadError, type TodayResult } from '../data/source';
import { isWorldSeries } from '../data/ws2026';
import { BEAT, FIRST_BEAT, REPLAY_RATE, WINDUP } from '../math/constants';
import { noTodayLede, seasonLede, todayLede } from '../math/deal';
import { callWindowEnd, clockLeft, countAfter, judged, replayLength, revealAt, urlStateResult } from '../math/flow';
import { PT } from '../math/pitcher';
import type { Call, Pitch } from '../math/types';
import { clamp, easeOut3, lerp } from '../math/util';
import { drawBall } from '../render/ball';
import { drawMitt } from '../render/catcher';
import { ctx2d, LAY, sizeCanvases, view } from '../render/env';
import { nativeFilter } from '../render/filter';
import { drawPitcher } from '../render/pitcher';
import { drawReveal, RV, type SceneState } from '../render/reveal';
import { ensureStatic, invalidateStatic, paintAhead, scene } from '../render/scene';
import { bootCard, copyResult, showCards } from '../ui/card';
import { CARD, fail, UI } from '../ui/dom';
import { announce, fillMatchup, setIndicator, setPhase, toast, updateScore } from '../ui/hud';
import { fillVerdict, placeVerdict } from '../ui/verdict';
import { DATE, Q, REDUCED, SELFTEST, STATE } from './params';
import { curP, G, setToday, world, type World } from './state';
import { endLoading, isBroken, pressFailure, showFailure, showLoading } from './states';
import { latestToday, watchMidnight } from './today';

const sNow = (now: number): number => (G.frozenS !== null ? G.frozenS : (now - G.trel) / 1000);

/** The device asks for less data (Save-Data, which Chromium reports and Safari doesn't). */
const saveData = (): boolean => (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;

// Safari has no requestIdleCallback; §4.1 waits 2 s there instead.
const whenIdle = (run: () => void): void => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => run());
  else window.setTimeout(run, 2000);
};

export function sceneState(now: number): SceneState {
  const P = curP();

  if (G.phase === 'pitch') return { s: sNow(now), r: null };
  if (G.phase === 'reveal' || G.phase === 'replay') {
    const r = G.frozenS !== null || REDUCED ? 10 : (now - G.revealT0) / 1000;

    if (G.phase === 'replay') {
      const s = -0.3 + ((now - G.replayT0) / 1000) * REPLAY_RATE;

      return { s: Math.min(s, P.k.toCatch + 0.06), r: 10, fg: 0.5, replay: true };
    }
    const s = G.frozenS !== null ? P.k.toCatch + 3 : (now - G.trel) / 1000;

    return { s, r, fg: lerp(1, 0.22, easeOut3(r / 0.45)) };
  }

  // start and card: the pitcher set on the mound
  return { s: PT[0] - 0.4, r: null };
}

export function render(now: number): void {
  const P = curP();
  const cam = ensureStatic(world().lens, P);
  const st = sceneState(now);
  const g = ctx2d(UI.scene);
  const dpr = view.dpr;

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.drawImage(LAY.back, 0, 0);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawPitcher(g, cam, P, st.s);
  if (st.r === null) {
    // the mitt under the catcher, and the ball over everything: the illustrative glove and the defocused
    // foreground must never hide the real flight
    drawMitt(g, cam, P, st.s, 1);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(LAY.front, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBall(g, cam, P, st.s);

    return;
  }
  const fg = st.fg ?? 1;

  drawMitt(g, cam, P, st.s, fg);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = fg;
  g.drawImage(LAY.front, 0, 0);
  g.globalAlpha = 1;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawReveal(g, cam, P, st);
}

/** NoToday has no pitch to draw, so the night behind its panel is empty, as it is while the page loads. */
function clearScene(): void {
  const g = ctx2d(UI.scene);

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, UI.scene.width, UI.scene.height);
}

export function beginPitch(i: number, opts: { first?: boolean } = {}): void {
  const prev = G.set[G.i];

  G.i = i;
  const P = curP();

  ensureStatic(world().lens, P);
  G.call = null;
  G.callS = null;
  G.revealAt = null;
  G.frozenS = null;
  const now = performance.now();
  const beat = opts.first ? FIRST_BEAT : BEAT;

  G.t0 = now;
  G.trel = now + (beat + WINDUP) * 1000;
  fillMatchup(P, !opts.first && (!prev || prev.batter.id !== P.batter.id || prev.pitcher.id !== P.pitcher.id || i === 0));
  setIndicator(P.countBefore.balls, P.countBefore.strikes, P.outs);
  UI.indPitch.textContent = `${i + 1}/${G.set.length}`;
  UI.indClock.style.transform = 'scaleX(1)';
  UI.btnBall.classList.remove('is-called');
  UI.btnStrike.classList.remove('is-called');
  UI.verdict.hidden = true;
  UI.verdict.classList.remove('show-chip', 'show-body');
  UI.matchup.classList.remove('yield');
  UI.score.classList.remove('yield');
  window.clearTimeout(G.tBody);
  window.clearTimeout(G.tAhead);
  // which pitch is in play, for tests
  UI.app.dataset.pitch = P.id;
  setPhase('pitch');
  updateScore(false);
  announce(`Pitch ${i + 1} of ${G.set.length}. ${P.batter.name}, bats ${P.batter.side === 'R' ? 'right' : 'left'}, against ${P.pitcher.name}.`);
  const active = document.activeElement as HTMLElement | null;

  // a press of Play leaves focus in the start panel, which fades out and then hides it
  if (!active || active === document.body || active.offsetParent === null || UI.start.contains(active)) UI.app.focus({ preventScroll: true });
}

export function tryCall(call: Call): void {
  if (G.phase !== 'pitch' || G.call) return;
  const P = curP();
  const s = G.frozenS !== null ? G.frozenS : (performance.now() - G.trel) / 1000;

  if (s < 0) {
    toast('Wait for the pitch');

    return;
  }
  G.call = call;
  G.callS = s;
  (call === 'strike' ? UI.btnStrike : UI.btnBall).classList.add('is-called');
  G.revealAt = revealAt(P, s);
}

/** Once the reveal has settled, the next pitch's scene (new eye, new batter) is painted off screen. */
function paintNext(): void {
  if (G.phase !== 'reveal' || G.i + 1 >= G.set.length) return;
  paintAhead(world().lens, G.set[G.i + 1]);
}

export function startReveal(now: number, instant = false): void {
  const P = curP();
  const res = judged(P, G.call || 'none');

  G.results[G.i] = res;
  G.revealT0 = instant ? now - 10000 : now;
  setPhase('reveal');
  const said = fillVerdict(P, res);

  UI.nextLabel.textContent = G.i + 1 < G.set.length ? 'Next pitch' : 'See your card';
  UI.btnReplay.disabled = false;
  UI.verdict.hidden = false;
  placeVerdict();
  const finish = (): void => {
    const c = countAfter(P);

    UI.verdict.classList.add('show-body');
    updateScore(!instant);
    setIndicator(c.balls, c.strikes, P.outs);
    if (!instant) UI.btnNext.focus({ preventScroll: true });
    announce(said);
  };

  window.clearTimeout(G.tBody);
  window.clearTimeout(G.tAhead);
  if (instant || REDUCED) {
    UI.verdict.classList.add('show-chip');
    finish();
  } else {
    requestAnimationFrame(() => UI.verdict.classList.add('show-chip'));
    G.tBody = window.setTimeout(finish, RV.body * 1000);
  }
  G.tAhead = window.setTimeout(paintNext, instant ? 300 : 1300);
}

export function startReplay(): void {
  if (G.phase !== 'reveal') return;
  G.replayT0 = performance.now();
  setPhase('replay');
  UI.btnReplay.disabled = true;
}

export function nextPitch(): void {
  if (G.phase !== 'reveal' && G.phase !== 'replay') return;
  if (G.i + 1 < G.set.length) beginPitch(G.i + 1);
  else {
    showCards();
    // The season's shard is parsed once the card has painted and the page is idle: a parse takes tens of milliseconds,
    // more on a phone. A press that comes sooner parses it at once. A failure waits for the press, which tries again and
    // says what went wrong.
    if (!saveData()) {
      whenIdle(() => {
        if (G.phase === 'card') world().another.ready().catch(() => undefined);
      });
    }
  }
}

/** The start panel fades out as a round begins. */
function hideStart(): void {
  UI.start.classList.add('leaving');
  window.setTimeout(() => {
    UI.start.hidden = true;
    UI.start.classList.remove('leaving');
  }, REDUCED ? 0 : 380);
}

const todayLoads = latestToday((dateKey, signal) => world().source.today(dateKey, signal));
// A press of Play while a date's Ten loads starts the round once it has.
let playWhenLoaded = false;

export function startGame(): void {
  // Try again, or Reload
  if (pressFailure()) return;
  if (G.phase !== 'start') return;
  if (todayLoads.busy()) {
    playWhenLoaded = true;

    return;
  }
  // NoToday's button deals Another ten, whatever the date
  if (!G.set.length) {
    void playAnother(UI.btnPlay);

    return;
  }
  // a Ten from a date the clock has left gives way to the new date's, and the round starts on that (§2.2)
  if (checkDate()) {
    playWhenLoaded = true;

    return;
  }
  hideStart();
  G.results = [];
  beginPitch(0, { first: true });
}

let dealing = false;
const AGAIN = 'Play another ten';
// The Another ten button whose press reloads the page: its deck's data is damaged, or from another build.
let reloadFrom: HTMLButtonElement | null = null;

/**
 * "Play another ten", on the card or in NoToday: the next ten from the source's decks, with none of Today's Ten and no
 * pitch dealt earlier on this page (§3). Under Save-Data, this is when the season's shard loads. While a deck loads, the
 * button says so (§5.2). A deck that's ready deals before the next paint, so then it never shows. If the deck can't
 * load, the button offers to try again; if its data is damaged, a reload, as Broken does (§5.1).
 */
export async function playAnother(btn: HTMLButtonElement): Promise<void> {
  const w = world();
  let ten: Pitch[];

  if (reloadFrom === btn) {
    location.reload();

    return;
  }
  // one deal per press, however long the deck takes
  if (dealing) return;
  dealing = true;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = 'Dealing…';
  try {
    ten = await w.another.deal();
  } catch (e) {
    // A file that doesn't read right reads the same on a second try, which re-reads the text it has, so only a reload
    // helps. Its detail, like any fault's, goes to the error box; a load that failed is the button's to say.
    const damaged = e instanceof LoadError && e.kind === 'data';

    if (damaged || !(e instanceof LoadError)) fail(e instanceof Error ? e.message : String(e));
    if (damaged) reloadFrom = btn;
    btn.textContent = damaged ? "Couldn't load more pitches. Reload the page" : "Couldn't load more pitches. Try again";
    announce("Couldn't load more pitches.");

    return;
  } finally {
    dealing = false;
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
  btn.textContent = AGAIN;
  G.set = ten.map(prep);
  G.mode = 'pool';
  G.results = [];
  G.i = 0;
  invalidateStatic();
  if (G.phase === 'start') hideStart();
  CARD.root.hidden = true;
  CARD.root.classList.remove('enter');
  beginPitch(0, { first: true });
}

function tick(now: number): void {
  if (G.phase === 'pitch' && G.frozenS === null) {
    const P = curP();
    const s = (now - G.trel) / 1000;

    UI.indClock.style.transform = `scaleX(${s < 0 ? 1 : clockLeft(P, s).toFixed(4)})`;
    if (!G.call && s > callWindowEnd(P)) {
      G.call = 'none';
      G.callS = s;
      G.revealAt = s;
    }
    if (G.call && G.revealAt !== null && s >= G.revealAt) startReveal(now);
  } else if (G.phase === 'replay') {
    const e = (now - G.replayT0) / 1000;

    if (e > replayLength(curP())) {
      setPhase('reveal');
      UI.btnReplay.disabled = false;
      UI.btnReplay.focus({ preventScroll: true });
      window.clearTimeout(G.tAhead);
      G.tAhead = window.setTimeout(paintNext, 400);
    }
  }
}

let lastIdleKey = '';

function frame(now: number): void {
  requestAnimationFrame(frame);
  tick(now);
  // NoToday has no pitch to show, and leaves the night empty, as it is while the page loads
  if (G.phase === 'card' || !G.set.length) return;
  // the start scene is still: paint it once per layout instead of every frame
  if (G.phase === 'start') {
    const k = `${scene.key}|${G.i}`;

    if (k === lastIdleKey && scene.cam) return;
    lastIdleKey = k;
  } else lastIdleKey = '';
  render(now);
}

function onResize(): void {
  sizeCanvases(UI.scene);
  invalidateStatic();
  if (G.phase === 'reveal' || G.phase === 'replay') placeVerdict();
}

function onKey(e: KeyboardEvent): void {
  if (e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
  const k = e.key;
  const onButton = e.target instanceof HTMLElement && e.target.tagName === 'BUTTON';

  if (G.phase === 'pitch') {
    if (k === 's' || k === 'S' || k === 'ArrowRight') {
      e.preventDefault();
      tryCall('strike');
    } else if (k === 'b' || k === 'B' || k === 'ArrowLeft') {
      e.preventDefault();
      tryCall('ball');
    }
  } else if (G.phase === 'reveal' || G.phase === 'replay') {
    if (k === 'r' || k === 'R') {
      e.preventDefault();
      startReplay();
    } else if ((k === ' ' || k === 'Enter') && !onButton) {
      e.preventDefault();
      nextPitch();
    }
  } else if (G.phase === 'start' && k === 'Enter' && !onButton) {
    e.preventDefault();
    startGame();
  }
}

// a hidden tab would break the real-time flight: re-pitch when the viewer comes back
function onVisibility(): void {
  if (document.hidden && G.phase === 'pitch' && !G.call && G.frozenS === null) G.repitch = true;
  else if (!document.hidden && G.repitch) {
    G.repitch = false;
    beginPitch(G.i);
  }
}

export function wireInput(): void {
  UI.btnBall.addEventListener('click', () => tryCall('ball'));
  UI.btnStrike.addEventListener('click', () => tryCall('strike'));
  UI.btnReplay.addEventListener('click', startReplay);
  UI.btnNext.addEventListener('click', nextPitch);
  UI.btnPlay.addEventListener('click', startGame);
  CARD.copy.addEventListener('click', () => void copyResult());
  CARD.again.addEventListener('click', () => void playAnother(CARD.again));
  window.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('resize', onResize);
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Without the pitches there is nothing to call: say so on the start screen rather than leave it loading. */
export function dataFailed(e: unknown): void {
  fail(`The pitch data didn't load: ${messageOf(e)}`);
  // Only a failed connection is worth a reload; for a missing or broken file, the error box says what's wrong.
  UI.startLede.textContent = e instanceof LoadError && (e.kind === 'network' || e.kind === 'offline')
    ? "The pitches didn't load, so there's nothing to call yet. Check your connection, then reload the page."
    : "The pitches didn't load, so there's nothing to call yet. The note at the bottom of the screen says what went wrong.";
  UI.btnPlay.disabled = true;
  UI.btnPlay.textContent = "Couldn't load the pitches";
  document.documentElement.dataset.ready = 'error';
}

/** The start lede for Today's Ten: the World Series names its games, and the season its date. */
function todayLedeOf(w: World): string {
  return isWorldSeries(w.source) ? todayLede(w.today, w.source.label) : seasonLede(w.today, w.source.label, dateLabel(w.dateKey));
}

/** The World's date and its ten's IDs, for tests: "none" when the date has no Ten. */
function markToday(w: World): void {
  document.documentElement.dataset.date = w.dateKey;
  UI.app.dataset.ten = w.today.length ? w.today.map((p) => p.id).join(' ') : 'none';
}

/**
 * The start screen for the World's date: Today's Ten, ready to play, or NoToday, which offers Another ten instead (§5.1).
 * Then the page says it's ready.
 */
function showStart(): void {
  const w = world();

  endLoading();
  // the start screen's button is about to say something else, so a press means what it says again
  if (reloadFrom === UI.btnPlay) reloadFrom = null;
  G.set = w.today;
  G.mode = 'today';
  G.results = [];
  G.i = 0;
  setPhase('start');
  markToday(w);
  UI.btnPlay.disabled = false;
  if (w.today.length) {
    const P = curP();

    UI.startLede.textContent = todayLedeOf(w);
    UI.btnPlay.textContent = 'Play ball';
    fillMatchup(P, false);
    setIndicator(P.countBefore.balls, P.countBefore.strikes, P.outs);
    UI.indPitch.textContent = `1/${G.set.length}`;
    updateScore(false);
    invalidateStatic();
    render(performance.now());
    if (!isWorldSeries(w.source)) announce("Today's Ten is ready.");
  } else {
    UI.startLede.textContent = noTodayLede(dateLabel(w.dateKey), w.source.label);
    UI.btnPlay.textContent = 'Play another ten';
    clearScene();
    // Another ten is all there is to play, so its shard loads at once (§4.1). The press parses it, so the parse never
    // holds up this screen's first paint.
    if (!saveData()) w.source.prefetch?.();
  }
  if (!SELFTEST) UI.btnPlay.focus({ preventScroll: true });
  document.documentElement.dataset.ready = w.today.length ? '1' : 'none';
}

/** The frozen state a ?state= URL asks for, on Today's Ten. */
function bootState(): void {
  const w = world();
  const idx = clamp(parseInt(Q.get('i') || '1', 10) || 1, 1, w.today.length) - 1;

  G.set = w.today;
  G.mode = 'today';
  G.results = [];
  markToday(w);
  UI.startLede.textContent = todayLedeOf(w);
  UI.btnPlay.disabled = false;
  UI.btnPlay.textContent = 'Play ball';
  if (STATE === 'card') bootCard(clamp(parseInt(Q.get('correct') || '8', 10) || 0, 0, G.set.length));
  else {
    UI.start.hidden = true;
    for (let k = 0; k < idx; k++) G.results[k] = urlStateResult(G.set[k]);
    beginPitch(idx, { first: true });
    if (STATE === 'pitch') {
      const t = parseFloat(Q.get('t') || '');

      G.frozenS = Number.isFinite(t) ? t : 0.25;
    } else {
      G.frozenS = curP().k.toCatch + 3;
      G.call = Q.get('call') === 'ball' ? 'ball' : 'strike';
      startReveal(performance.now(), true);
    }
  }
  render(performance.now());
  document.documentElement.dataset.ready = '1';
}

/** The date the clock says, unless ?date= sets it or the source's Ten doesn't depend on it, as the World Series' doesn't. */
const clockDate = (): string | null => (DATE === null && !isWorldSeries(world().source) ? dateKeyOf(new Date()) : null);

/**
 * Puts the clock's date's Ten on the start screen if the date has moved on from the screen's (§2.2). Only the start screen
 * follows the clock: a round keeps the date it began on. Says whether the date had moved on.
 */
function checkDate(): boolean {
  const dateKey = clockDate();

  if (dateKey === null || G.phase !== 'start' || isBroken() || dateKey === world().dateKey) return false;
  void switchDate(dateKey);

  return true;
}

/** Loads a date's Ten in place of the start screen's, with Play waiting meanwhile. The latest date asked for wins. */
async function switchDate(dateKey: string): Promise<void> {
  let today: TodayResult | null;

  showLoading();
  try {
    today = await todayLoads.load(dateKey);
  } catch (e) {
    playWhenLoaded = false;
    await showFailure(e);
    // Try again, or back online: the date the clock says by then
    void switchDate(clockDate() ?? dateKey);

    return;
  }
  if (!today) return;
  setToday(world(), today);
  showStart();
  if (playWhenLoaded) {
    playWhenLoaded = false;
    // a date without a Ten shows NoToday, and waits for its own press
    if (G.set.length) startGame();
  }
}

/** Today's Ten or NoToday on the start screen, or the frozen state a ?state= URL asks for; then the frame loop. */
export function bootFlow(): void {
  const w = world();
  const de = document.documentElement;

  // only the World Series' footnotes count its real challenges
  for (const el of document.querySelectorAll<HTMLElement>('.ws-only')) el.hidden = !isWorldSeries(w.source);
  de.dataset.viewport = `${view.w}x${view.h}@${view.dpr}`;
  de.dataset.canvasFilter = nativeFilter() ? 'native' : 'fallback';
  if (w.today.length && (STATE === 'pitch' || STATE === 'reveal' || STATE === 'card')) bootState();
  else {
    showStart();
    // Another ten's shard loads while the player reads the start screen, unless the device asks for less data (§4.1).
    // Safari's stand-in can come after Play; the card loads it then.
    if (w.today.length && !saveData()) {
      whenIdle(() => {
        if (G.phase === 'start') w.source.prefetch?.();
      });
    }
    if (clockDate() !== null) {
      watchMidnight(() => void checkDate());
      // a midnight while the page booted, after it read the date (§2.2)
      checkDate();
    }
  }
  requestAnimationFrame(frame);
}
