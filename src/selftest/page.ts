import { isWorldSeries } from '../data/ws2026';
import { world } from '../game/state';
import { BEAT } from '../math/constants';
import { LAY, view } from '../render/env';
import { ensureStatic, invalidateStatic } from '../render/scene';
import { UI } from '../ui/dom';
import { runSelfTest, SEASON_CHECKS, seasonSelfTestContext, selfTestContext } from './checks';

/** ?selftest=1: the mockup's report, on the page, with the verdict in the title for scripts to read. */
export function showSelfTest(): boolean {
  const w = world();
  const ws = isWorldSeries(w.source) ? w.source.ws : null;
  // The World Series' report is the mockup's, with its figures. The season's covers the date's Ten.
  const { lines, failures } = ws
    ? runSelfTest(selfTestContext(ws, w.today))
    : w.today.length
      ? runSelfTest(seasonSelfTestContext(w.today, w.lens), SEASON_CHECKS)
      : { lines: ["UMPIRE'S EYE SELF-TEST", `There's no Today's Ten for ${w.dateKey} to check. Pick a date that has one with ?date=.`, 'RESULT: FAIL (1) no ten'], failures: ['no ten'] };
  const [title, ...rest] = lines;
  const source = ws ? 'the World Series pool, with the mockup\'s figures' : `the 2026 season's Today's Ten for ${w.dateKey}; the pool-wide checks are data:validate's`;

  document.title = failures.length ? 'SELFTEST FAIL' : 'SELFTEST PASS';
  UI.selftest.hidden = false;
  UI.selftest.textContent = [title, `source: ${source}`, `document.compatMode = ${document.compatMode}`, ...rest].join('\n');

  return !failures.length;
}

/** The static layers are repainted for every new stance (new eye, batter and lens blur): time it, raster included. */
export async function paintTiming(): Promise<void> {
  const w = world();
  const ms: number[] = [];

  for (const P of w.today) {
    invalidateStatic();
    const t0 = performance.now();

    ensureStatic(w.lens, P);
    if (typeof createImageBitmap === 'function') await Promise.all([createImageBitmap(LAY.back), createImageBitmap(LAY.front)]);
    ms.push(performance.now() - t0);
  }
  invalidateStatic();
  const mean = ms.reduce((a, b) => a + b, 0) / ms.length;

  UI.selftest.textContent += `\n[STANCE] static layers for a new stance at ${view.w}x${view.h} (DPR ${view.dpr}): ${Math.min(...ms).toFixed(0)}-${Math.max(...ms).toFixed(0)} ms to paint (mean ${mean.toFixed(0)}), done off screen once the reveal has settled; "Next pitch" swaps them in and the beat (${BEAT} s) follows`;
}
