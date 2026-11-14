// The start screen while the season's Today's Ten loads, and when it can't (docs/M2-DESIGN.md §5.1). The World Series
// keeps M1's: its one file loads before the page opens.
import { LoadError, type LoadErrorKind } from '../data/source';
import { fail, UI } from '../ui/dom';
import { announce } from '../ui/hud';

// After this long, a line under the button says a slow connection can take a while.
const SLOW_MS = 6_000;

let slowTimer = 0;
// What a press of the main button does in Failed (load again) or Broken (reload); null in any other state.
let onPress: (() => void) | null = null;
// Broken lasts until the page reloads: a later date that loaded would leave the error box's detail over a page that
// looked fine.
let broken = false;

export const isBroken = (): boolean => broken;

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Loading: Play waits, disabled, and the panel is busy. */
export function showLoading(): void {
  const de = document.documentElement;

  if (onPress) window.removeEventListener('online', onPress);
  onPress = null;
  delete de.dataset.ready;
  delete de.dataset.error;
  UI.start.setAttribute('aria-busy', 'true');
  UI.btnPlay.disabled = true;
  UI.btnPlay.textContent = "Loading today's pitches";
  window.clearTimeout(slowTimer);
  UI.slow.hidden = true;
  slowTimer = window.setTimeout(() => {
    UI.slow.hidden = false;
  }, SLOW_MS);
}

/** Loading is over, whichever way it went. */
export function endLoading(): void {
  window.clearTimeout(slowTimer);
  UI.slow.hidden = true;
  UI.start.removeAttribute('aria-busy');
}

function say(lede: string, button: string): void {
  UI.startLede.textContent = lede;
  UI.btnPlay.disabled = false;
  UI.btnPlay.textContent = button;
  UI.btnPlay.focus({ preventScroll: true });
  announce(lede);
}

/**
 * Failed or Broken, by the error's kind (§5.3). Failed resolves when Try again is pressed or the device comes back
 * online, and the caller loads again. Broken never resolves: its button reloads the page, and the error box says what
 * was wrong with the data.
 */
export function showFailure(e: unknown): Promise<void> {
  const kind: LoadErrorKind = e instanceof LoadError ? e.kind : 'data';
  const de = document.documentElement;

  endLoading();
  de.dataset.ready = 'error';
  de.dataset.error = kind;
  if (kind === 'data') {
    broken = true;
    fail(`The pitch data didn't load: ${messageOf(e)}`);
    say('The pitch data is out of date or damaged. Reload the page.', 'Reload');
    onPress = () => location.reload();

    return new Promise(() => undefined);
  }
  say(kind === 'offline' ? "You're offline. Connect and try again." : "Today's pitches didn't load. Check your connection and try again.", 'Try again');

  return new Promise((resolve) => {
    const again = (): void => {
      window.removeEventListener('online', again);
      onPress = null;
      resolve();
    };

    onPress = again;
    window.addEventListener('online', again);
  });
}

/** A press of the main button in Failed or Broken. Says whether one of them took it. */
export function pressFailure(): boolean {
  if (!onPress) return false;
  onPress();

  return true;
}
