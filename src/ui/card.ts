import { PLATE_HALF } from '../core/rules.ts';
import { dateLabel } from '../data/dates';
import type { UmpFigure } from '../data/source';
import { isWorldSeries } from '../data/ws2026';
import { REDUCED } from '../game/params';
import { G, world } from '../game/state';
import { seriesGames } from '../math/deal';
import { cardStateResults } from '../math/flow';
import { clamp } from '../math/util';
import { figureWords, resultText, setLine, toughest, type Result } from '../math/words';
import { CARD, UI } from './dom';
import { announce, setPhase } from './hud';

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(NS, tag);

  for (const k in attrs) e.setAttribute(k, String(attrs[k]));

  return e;
}

const roundLabel = (): string => (G.mode === 'today' ? "Today's Ten" : 'Another ten');
// A season's Today's Ten is the date's; the World Series' is the same every day.
const roundDate = (): string | null => (G.mode === 'today' && !isWorldSeries(world().source) ? dateLabel(world().dateKey) : null);

/** The card back's miss map, in the catcher's view: an X for each miss, a dot for each right call, per batter's zone. */
export function drawMissMap(results: readonly (Result | undefined)[]): void {
  const S = 52;
  const cx = 120;
  const zTop = 22;
  const zBot = 102;
  const INK = '#2b261f';
  const svg = CARD.map;
  const hw = PLATE_HALF * S;
  const zh = zBot - zTop;

  svg.replaceChildren();
  // inked on the stock: a framed map, the zone with dashed thirds, the plate
  svg.append(svgEl('rect', { x: 4, y: 8, width: 232, height: 136, fill: 'none', stroke: INK, 'stroke-width': 1.3, opacity: 0.8 }));
  svg.append(svgEl('rect', { x: cx - hw, y: zTop, width: 2 * hw, height: zh, fill: 'none', stroke: INK, 'stroke-width': 2 }));
  for (const f of [1 / 3, 2 / 3]) {
    svg.append(svgEl('line', { x1: cx - hw + 2 * hw * f, y1: zTop, x2: cx - hw + 2 * hw * f, y2: zBot, stroke: INK, 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0.7 }));
    svg.append(svgEl('line', { x1: cx - hw, y1: zTop + zh * f, x2: cx + hw, y2: zTop + zh * f, stroke: INK, 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0.7 }));
  }
  svg.append(svgEl('path', { d: `M${cx - hw} 118 H${cx + hw} V126 L${cx} 136 L${cx - hw} 126 Z`, fill: 'none', stroke: INK, 'stroke-width': 1.5 }));
  let misses = 0;

  results.forEach((r) => {
    if (!r) return;
    const P = r.P;
    const zn = (P.k.mid.z - P.zone.bottom) / (P.zone.top - P.zone.bottom);
    const x = clamp(cx + P.k.mid.x * S, 10, 230);
    const y = clamp(zBot - zn * zh, 13, 139);

    if (r.correct) svg.append(svgEl('circle', { cx: x, cy: y, r: 4, fill: INK }));
    else {
      misses++;
      svg.append(svgEl('path', { d: `M${x - 5} ${y - 5}L${x + 5} ${y + 5}M${x + 5} ${y - 5}L${x - 5} ${y + 5}`, stroke: '#E20074', 'stroke-width': 3.2, 'stroke-linecap': 'round' }));
    }
  });
  svg.setAttribute('aria-label', `Miss map: ${misses} missed call${misses === 1 ? '' : 's'} marked with an X, ${results.filter(Boolean).length - misses} right calls marked with dots, relative to each batter's zone.`);
}

export function showCards(instant = false): void {
  const label = world().source.label;
  const n = G.set.length;
  const right = G.results.filter((r) => r && r.correct).length;
  const ump = G.set.filter((P) => P.umpCorrect).length;
  const after = G.set.filter((P) => P.finalCall === P.absTruth).length;
  const pct = Math.round((right / n) * 100);
  const tough = toughest(G.results);
  // only a World Series round numbers its games; a season round's come from several series, or none
  const games = isWorldSeries(world().source) ? seriesGames(G.set) : [];

  CARD.num.textContent = String(pct);
  CARD.pitches.textContent = String(n);
  CARD.correct.textContent = String(right);
  CARD.ump.textContent = `${ump}/${n}`;
  CARD.tough.textContent = tough;
  CARD.tough.classList.toggle('long', tough.length > 14);
  CARD.set.textContent = setLine(label, roundLabel(), roundDate());
  CARD.caption.textContent = label;
  showCardFigure(world().figure);
  CARD.sum.innerHTML = `Round complete. You called <b>${right} of ${n}</b> right. On these same pitches the real ump got <b>${ump} of ${n}</b> on the field${after !== ump ? `, ${after} after ABS challenges` : ''}.`;
  if (games.length) CARD.sum.title = games.length > 1 ? `Games ${games.join(', ')}` : `Game ${games[0]}`;
  else CARD.sum.removeAttribute('title');
  drawMissMap(G.results);
  CARD.copy.textContent = 'Copy result';
  setPhase('card');
  CARD.root.hidden = false;
  CARD.root.classList.toggle('enter', !instant && !REDUCED);
  CARD.root.scrollTop = 0;
  if (!instant) CARD.copy.focus({ preventScroll: true });
  announce(`Round complete. You called ${right} of ${n} right, ${pct} percent. The real ump got ${ump} of ${n}.`);
}

/** The card back's ump figure row and its citation; without a figure, the row goes and the citation leaves it out. */
export function showCardFigure(f: UmpFigure | null): void {
  const { row, cite } = figureWords(f);

  CARD.figRow.hidden = !row;
  CARD.figLabel.textContent = row?.label ?? '';
  CARD.fig.textContent = row?.value ?? '';
  CARD.foot.textContent = `${cite ? `${cite} ` : ''}The real ump: original calls vs ABS on these pitches.`;
}

/** ?state=card&correct=N: the card for a round with N right, the misses on the closest pitches. */
export function bootCard(correct: number): void {
  G.results = cardStateResults(G.set, correct);
  UI.start.hidden = true;
  showCards(true);
}

export async function copyResult(): Promise<void> {
  const w = world();
  const text = resultText({ label: w.source.label, roundLabel: roundLabel(), date: roundDate(), figure: w.figure, set: G.set, results: G.results });
  let ok = false;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch {
    ok = false;
  }
  if (!ok) {
    const ta = document.createElement('textarea');

    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
  }
  CARD.copy.textContent = ok ? 'Copied ✓' : 'Copy failed: select the text';
  announce(ok ? 'Result copied to the clipboard.' : 'Copy failed.');
  if (!ok) window.prompt('Copy your result:', text);
  window.setTimeout(() => {
    CARD.copy.textContent = 'Copy result';
  }, 2200);
}
