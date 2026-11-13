import { BALL_R, MID_Y, PLATE_HALF } from '../core/rules.ts';
import { curP, world } from '../game/state';
import { batterBody } from '../math/batter';
import type { Pt, Rect } from '../math/geometry';
import type { PreparedPitch } from '../math/kinematics';
import { crossRect } from '../math/mask';
import { pitcherPose } from '../math/pitcher';
import { clamp } from '../math/util';
import { callWord, lastName, marginPhrase, type Result } from '../math/words';
import { IMG, view } from '../render/env';
import { pathDots } from '../render/reveal';
import { UI } from './dom';

const ICON_OK = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10.5l4.5 4.5L17 5" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_NO = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 4.5l11 11M15.5 4.5l-11 11" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>';

/** Fills the verdict panel and returns the sentence the screen reader hears. */
export function fillVerdict(P: PreparedPitch, res: Result): string {
  UI.vUmp.textContent = callWord(P.umpCall);
  const seg = (txt: string, cls: string, icon = ''): HTMLSpanElement => {
    const s = document.createElement('span');

    s.className = `seg ${cls}`;
    s.innerHTML = icon;
    s.append(txt);

    return s;
  };
  const dot = (): HTMLSpanElement => {
    const s = document.createElement('span');

    s.className = 'dot';
    s.textContent = '·';
    s.setAttribute('aria-hidden', 'true');

    return s;
  };

  UI.vLine.replaceChildren(
    seg(`You ${callWord(res.call)}`, res.correct ? 'ok' : 'bad', res.correct ? ICON_OK : ICON_NO),
    dot(),
    seg(`Ump ${callWord(P.umpCall)}`, P.umpCorrect ? 'ok' : 'miss'),
    dot(),
    seg(`ABS ${callWord(P.absTruth)}`, 'abs'),
  );
  const parts: string[] = [];

  if (res.call === 'none') parts.push('Time ran out, which counts as a miss');
  if (P.challenge) {
    const c = P.challenge;

    parts.push(`${lastName(c.by)} (${c.byTeam} ${c.byRole}) challenged, ${c.isOverturned ? 'overturned' : 'call stood'}`);
  }
  parts.push(marginPhrase(P));
  UI.vCtx.textContent = parts.join(' · ');
  UI.vMeta.textContent = `${P.pitchType.name} · ${P.startSpeed.toFixed(1)} mph · ${lastName(P.batter.name)} vs ${lastName(P.pitcher.name)}`;

  return `You ${callWord(res.call)}, ump ${callWord(P.umpCall)}, ABS ${callWord(P.absTruth)}. ${res.correct ? 'Right call.' : 'Missed it.'} ${UI.vCtx.textContent}.`;
}

interface Keep extends Rect {
  /** Cost per px² of overlap. */
  w: number;
}

interface Slot {
  w: number;
  x: number;
  y: 'mid' | 'top' | 'low' | number;
  pen: number;
}

const shown = (n: HTMLElement): boolean => !n.hidden && n.offsetParent !== null;

/**
 * Desktop and tablet: the panel goes on the side away from the batter (mid-right for a right-hander, mid-left for a
 * left-hander), off his body, clear of this pitch's ring, path and zone, the indicator and the controls, and as far as
 * the width allows clear of every crossing the game can deal. Phones keep the full-width CSS layout.
 */
export function placeVerdict(): void {
  const el = UI.verdict;
  const v = el.style;
  const VW = view.w;
  const VH = view.h;

  v.left = v.top = v.width = v.transform = '';
  el.classList.remove('tight', 'narrow');
  UI.matchup.classList.remove('yield');
  UI.score.classList.remove('yield');
  if (VW <= 640) return;
  const P = curP();
  const lens = world().lens;
  const cam = lens.camFor(VW, VH, P);
  const keep: Keep[] = [];
  const add = (pts: readonly Pt[], pad: number, w: number): void => {
    let l = 1e9;
    let r = -1e9;
    let t = 1e9;
    let b = -1e9;

    for (const q of pts) {
      l = Math.min(l, q.x);
      r = Math.max(r, q.x);
      t = Math.min(t, q.y);
      b = Math.max(b, q.y);
    }
    keep.push({ l: l - pad, r: r + pad, t: t - pad, b: b + pad, w });
  };
  const corners: [number, number][] = [[-PLATE_HALF, P.zone.top], [PLATE_HALF, P.zone.top], [PLATE_HALF, P.zone.bottom], [-PLATE_HALF, P.zone.bottom]];
  const zone = corners.map(([x, z]) => cam.p({ x, y: MID_Y, z }));

  add(zone, 14, 30);
  const m = cam.p(P.k.mid);
  const mr = BALL_R * m.k + 8;

  add([{ x: m.x - mr, y: m.y - mr }, { x: m.x + mr, y: m.y + mr }], 10, 60);
  for (const d of pathDots(cam, P)) add([d.q], 8, 20);
  const J = pitcherPose(P, 2);

  add(Object.values(J).map((q) => cam.p(q)), 0.5 * cam.p(J.pel).k, 6);
  const bb = batterBody(cam, P, !!IMG.bat.naturalWidth);

  add([{ x: bb.l, y: bb.t }, { x: bb.r, y: bb.b }], 12, 25);
  const band = crossRect(lens, cam);

  keep.push({ ...band, w: 2 });
  const wide = VW > 1180;

  for (const n of [UI.indicator, UI.btnReplay, UI.btnNext, ...(wide ? [UI.matchup, UI.score] : [])]) {
    if (!shown(n)) continue;
    const r = n.getBoundingClientRect();

    keep.push({ l: r.left - 12, r: r.right + 12, t: r.top - 12, b: r.bottom + 12, w: 40 });
  }
  const E = 24;
  const away = P.batter.side === 'R' ? 1 : -1;
  // the free column on the away side: under that side's HUD card, over that side's control
  const cap = wide ? (away > 0 ? UI.score : UI.matchup).getBoundingClientRect().bottom + 14 : E;
  const lows = (away > 0 ? [UI.indicator, UI.btnNext] : [UI.btnReplay, UI.btnBall]).filter(shown);
  const floor = Math.min(...lows.map((n) => n.getBoundingClientRect().top)) - 14;
  const room = (edge: number): number => (away > 0 ? VW - E - edge : edge - E);
  const zl = Math.min(zone[0].x, zone[3].x);
  const zr = Math.max(zone[1].x, zone[2].x);
  const zmid = (zone[0].y + zone[3].y) / 2;
  const widths = [...new Set([room(away > 0 ? band.r + 14 : band.l - 14), room(away > 0 ? zr + 20 : zl - 20), 340].map((w) => Math.round(clamp(w, 260, 440))))];
  const slots: Slot[] = [];

  for (const w of widths) {
    const x = away > 0 ? VW - E - w : E;

    for (const y of ['mid', 'top', 'low'] as const) slots.push({ w, x, y, pen: 0 });
  }
  // fallbacks for odd cases (a crossing far out on the away side): the old top slots, at a cost
  for (const w0 of [560, 480]) {
    const w = Math.min(w0, VW - 2 * E);
    const mid = clamp((zl + zr) / 2 - w / 2, E, VW - E - w);

    slots.push({ w, x: mid, y: E, pen: 4e4 }, { w, x: away > 0 ? VW - E - w : E, y: cap, pen: 4e4 });
  }
  let best: { w: number; x: number; y: number; cost: number } | null = null;

  for (const s of slots) {
    v.width = `${s.w}px`;
    el.classList.toggle('tight', s.w < 600);
    el.classList.toggle('narrow', s.w < 420);
    const h = el.offsetHeight;
    const y = s.y === 'mid' ? clamp(zmid - h / 2, cap, floor - h) : s.y === 'top' ? cap : s.y === 'low' ? floor - h : s.y;
    const r = { l: s.x, r: s.x + s.w, t: y, b: y + h };
    let cost = s.pen + (440 - s.w) * 20 + (r.l < 0 || r.t < 0 || r.r > VW || r.b > VH ? 1e9 : 0);

    for (const q of keep) {
      const ox = Math.min(r.r, q.r) - Math.max(r.l, q.l);
      const oy = Math.min(r.b, q.b) - Math.max(r.t, q.t);

      if (ox > 0 && oy > 0) cost += ox * oy * q.w;
    }
    if (!best || cost < best.cost) best = { w: s.w, x: s.x, y, cost };
  }
  if (!best) return;
  v.width = `${best.w}px`;
  v.left = `${Math.round(best.x)}px`;
  v.top = `${Math.round(best.y)}px`;
  v.transform = 'none';
  el.classList.toggle('tight', best.w < 600);
  el.classList.toggle('narrow', best.w < 420);
  // a rare far-off crossing can sit under a HUD corner: that card steps aside for the reveal
  for (const n of [UI.matchup, UI.score]) {
    const r = n.getBoundingClientRect();

    n.classList.toggle('yield', r.right > m.x - mr && r.left < m.x + mr && r.bottom > m.y - mr && r.top < m.y + mr);
  }
}
