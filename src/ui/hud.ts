import { REDUCED } from '../game/params';
import { G, type Phase } from '../game/state';
import type { PreparedPitch } from '../math/kinematics';
import { fmtHeight, type Result } from '../math/words';
import { UI } from './dom';

/** Screen readers hear it even when the same words come twice. */
export function announce(msg: string): void {
  UI.live.textContent = '';
  requestAnimationFrame(() => {
    UI.live.textContent = msg;
  });
}

let toastT = 0;

export function toast(msg: string): void {
  UI.toast.textContent = msg;
  UI.toast.classList.add('on');
  window.clearTimeout(toastT);
  toastT = window.setTimeout(() => UI.toast.classList.remove('on'), 1300);
}

export function setPhase(ph: Phase): void {
  G.phase = ph;
  UI.app.dataset.phase = ph;
  const calling = ph === 'pitch' || ph === 'start';

  UI.btnBall.hidden = UI.btnStrike.hidden = !calling;
  UI.btnReplay.hidden = UI.btnNext.hidden = calling || ph === 'card';
}

export function fillMatchup(P: PreparedPitch, animate: boolean): void {
  const gm = P.game;

  if (animate) {
    UI.matchup.classList.remove('swap');
    void UI.matchup.offsetWidth;
    UI.matchup.classList.add('swap');
  }
  UI.muInning.textContent = `${P.half === 'top' ? 'Top' : 'Bot'} ${P.inning}`;
  UI.muOuts.querySelectorAll('i').forEach((el, k) => el.classList.toggle('on', k < P.outs));
  UI.muOuts.setAttribute('aria-label', `${P.outs} out${P.outs === 1 ? '' : 's'}`);
  const bases = UI.muBases.querySelectorAll('rect');

  ['1B', '2B', '3B'].forEach((b, k) => bases[k].classList.toggle('on', P.runnersOn.includes(b)));
  UI.muScore.textContent = `${gm.away} ${P.score.away} · ${gm.home} ${P.score.home}`;
  UI.muBatter.textContent = P.batter.name;
  UI.muBatterMeta.textContent = `Bats ${P.batter.side} · ${fmtHeight(P.batter.heightFt)}`;
  UI.muPitcher.textContent = P.pitcher.name;
  UI.muPitcherMeta.textContent = `${P.pitcher.hand}HP`;
  UI.muGame.textContent = `${gm.label} · ${P.countBefore.balls}–${P.countBefore.strikes} count`;
}

/** The ump's palm indicator: balls, strikes and outs on its wheels. */
export function setIndicator(b: number, s: number, o: number): void {
  UI.wB.style.setProperty('--n', String(b));
  UI.wS.style.setProperty('--n', String(s));
  UI.wO.style.setProperty('--n', String(o));
  UI.indText.textContent = `Count ${b} balls, ${s} strikes, ${o} out${o === 1 ? '' : 's'}`;
}

export function scoreLine(): { right: number; n: number; ump: number } {
  const done = G.results.filter((r): r is Result => !!r);
  const right = done.filter((r) => r.correct).length;

  return { right, n: done.length, ump: done.filter((r) => r.P.umpCorrect).length };
}

export function updateScore(tick: boolean): void {
  const { right, n, ump } = scoreLine();

  // like for like: the real ump's original calls on these same pitches sit next to the ~94% hook
  // (desktop: long form; phone: "You 2/2" / "Ump 2/2" over "MLB ≈ 94%", one phrase per line)
  UI.scMain.innerHTML = n
    ? `<b class="sc-ph">You ${right}/${n}</b><span class="sc-dot"> · </span><span class="sc-ph"><span class="sc-long">Real ump on these</span><span class="sc-short">Ump</span> ${ump}/${n}</span>`
    : (G.mode === 'today' ? "Today's Ten" : 'Another ten');
  UI.scSub.innerHTML = n
    ? '<span class="sc-long">Close calls · MLB umps ≈ 94% overall</span><span class="sc-short">MLB ≈ 94%</span>'
    : '<span class="sc-long">Close calls · MLB umps ≈ 94%</span><span class="sc-short"><span class="sc-ph">Close calls</span><span class="sc-ph">MLB ≈ 94%</span></span>';
  UI.vScore.textContent = n ? `You ${right}/${n} · Real ump on these ${ump}/${n} · MLB umps ≈ 94% overall` : '';
  if (tick && !REDUCED) {
    UI.score.classList.remove('tick');
    void UI.score.offsetWidth;
    UI.score.classList.add('tick');
  }
}
