import { prep } from '../math/kinematics';
import { BEAT, FIRST_BEAT, REPLAY_RATE, WINDUP } from '../math/constants';
import { pickPoolTen, todayLede } from '../math/deal';
import { callWindowEnd, clockLeft, countAfter, judged, replayLength, revealAt, urlStateResult } from '../math/flow';
import { PT } from '../math/pitcher';
import type { Call } from '../math/types';
import { clamp, easeOut3, lerp } from '../math/util';
import { drawBall } from '../render/ball';
import { drawMitt } from '../render/catcher';
import { ctx2d, LAY, sizeCanvases, view } from '../render/env';
import { nativeFilter } from '../render/filter';
import { drawPitcher } from '../render/pitcher';
import { drawReveal, RV, type SceneState } from '../render/reveal';
import { ensureStatic, invalidateStatic, paintAhead, scene } from '../render/scene';
import { bootCard, copyResult, showCards } from '../ui/card';
import { CARD, UI } from '../ui/dom';
import { announce, fillMatchup, setIndicator, setPhase, toast, updateScore } from '../ui/hud';
import { fillVerdict, placeVerdict } from '../ui/verdict';
import { Q, REDUCED, SELFTEST, STATE } from './params';
import { curP, G, world } from './state';

const sNow = (now: number): number => (G.frozenS !== null ? G.frozenS : (now - G.trel) / 1000);

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
  setPhase('pitch');
  updateScore(false);
  announce(`Pitch ${i + 1} of ${G.set.length}. ${P.batter.name}, bats ${P.batter.side === 'R' ? 'right' : 'left'}, against ${P.pitcher.name}.`);
  const active = document.activeElement as HTMLElement | null;

  if (!active || active === document.body || active.offsetParent === null) UI.app.focus({ preventScroll: true });
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
  else showCards();
}

export function startGame(): void {
  if (G.phase !== 'start') return;
  UI.start.classList.add('leaving');
  window.setTimeout(() => {
    UI.start.hidden = true;
    UI.start.classList.remove('leaving');
  }, REDUCED ? 0 : 380);
  G.results = [];
  beginPitch(0, { first: true });
}

/** "Play another ten": a fresh deal from the whole pool, never repeating Today's Ten. */
export function playAnother(): void {
  const w = world();

  G.set = pickPoolTen(w.data.pitches, w.data.today, Math.random).map(prep);
  G.mode = 'pool';
  G.results = [];
  G.i = 0;
  invalidateStatic();
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
  if (G.phase === 'card') return;
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
  CARD.again.addEventListener('click', playAnother);
  window.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('resize', onResize);
}

/** Today's Ten on the start screen, or the frozen state a ?state= URL asks for; then the frame loop. */
export function bootFlow(): void {
  const w = world();

  G.set = w.today;
  G.mode = 'today';
  G.results = [];
  UI.startLede.textContent = todayLede(w.data.today, w.data.label);
  UI.btnPlay.disabled = false;
  UI.btnPlay.textContent = 'Play ball';
  const idx = clamp(parseInt(Q.get('i') || '1', 10) || 1, 1, G.set.length) - 1;

  if (STATE === 'pitch' || STATE === 'reveal') {
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
  } else if (STATE === 'card') {
    bootCard(clamp(parseInt(Q.get('correct') || '8', 10) || 0, 0, G.set.length));
  } else {
    G.i = 0;
    setPhase('start');
    const P = curP();

    fillMatchup(P, false);
    setIndicator(P.countBefore.balls, P.countBefore.strikes, P.outs);
    UI.indPitch.textContent = `1/${G.set.length}`;
    updateScore(false);
    if (!SELFTEST) UI.btnPlay.focus({ preventScroll: true });
  }
  render(performance.now());
  const de = document.documentElement;

  de.dataset.ready = '1';
  de.dataset.viewport = `${view.w}x${view.h}@${view.dpr}`;
  de.dataset.canvasFilter = nativeFilter() ? 'native' : 'fallback';
  requestAnimationFrame(frame);
}
