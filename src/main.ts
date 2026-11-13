import backdropWideUrl from './assets/img/backdrop-wide.webp';
import backdropUrl from './assets/img/backdrop.webp';
import batterUrl from './assets/img/batter.webp';
import { dateKeyOf } from './core/daily.ts';
import { LoadError } from './data/source';
import { openSource, sourceIdOf } from './data/sources';
import { bootFlow, wireInput } from './game/flow';
import { DATE, POOL, SELFTEST } from './game/params';
import { createWorld, setWorld } from './game/state';
import { BACKDROPS } from './render/backdrop';
import { IMG, sizeCanvases } from './render/env';
import { paintTiming, showSelfTest } from './selftest/page';
import { CARD, fail, UI } from './ui/dom';

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

window.addEventListener('error', (e) => fail(`Error: ${e.message} (line ${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => fail(`Error: ${message(e.reason)}`));

const loadImg = (img: HTMLImageElement, src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error(`Could not load ${src}`));
  img.src = src;
});

/** Without the pitches there is nothing to call: say so on the start screen rather than leave it loading. */
function dataFailed(e: unknown): void {
  fail(`The pitch data didn't load: ${message(e)}`);
  // Only a failed connection is worth a reload; for a missing or broken file, the error box says what's wrong.
  UI.startLede.textContent = e instanceof LoadError && (e.kind === 'network' || e.kind === 'offline')
    ? "The pitches didn't load, so there's nothing to call yet. Check your connection, then reload the page."
    : "The pitches didn't load, so there's nothing to call yet. The note at the bottom of the screen says what went wrong.";
  UI.btnPlay.textContent = "Couldn't load the pitches";
  document.documentElement.dataset.ready = 'error';
}

async function boot(): Promise<void> {
  sizeCanvases(UI.scene);
  wireInput();
  // The images load while the pitches do. Every load settles before the scene starts, and each failure comes back as a
  // message for the error box, though none of them stops the game.
  const assets = Promise.allSettled([
    loadImg(IMG.backdrop, backdropWideUrl).then(
      () => { IMG.bd = BACKDROPS.wide; },
      () => loadImg(IMG.backdrop, backdropUrl).then(() => { IMG.bd = BACKDROPS.old; }),
    ),
    CARD.art.decode().catch(() => {
      // decode() also rejects when the browser switches srcset candidates; only a broken image is a failure
      if (CARD.art.complete && !CARD.art.naturalWidth) throw new Error(`Could not load ${CARD.art.currentSrc || CARD.art.src}`);
    }),
    // if the photo fails, the procedural batter stands in
    loadImg(IMG.bat, batterUrl).catch(() => null),
    document.fonts ? document.fonts.load('800 32px "Big Shoulders Display"').catch(() => null) : null,
  ]).then((results) => results.flatMap((r) => (r.status === 'rejected' ? [message(r.reason)] : [])).join('\n'));

  try {
    const source = await openSource(sourceIdOf(POOL), import.meta.env.BASE_URL);
    const today = await source.today(DATE ?? dateKeyOf(new Date()));

    if (today.kind === 'none') throw new LoadError('data', `There's no Today's Ten for ${today.dateKey}.`);
    setWorld(createWorld(source, today.pitches));
  } catch (e) {
    dataFailed(e);

    return;
  }
  if (SELFTEST) {
    try {
      showSelfTest();
    } catch (e) {
      fail(`Self-test crashed: ${message(e)}`);
    }
  }
  const assetError = await assets;

  if (assetError) fail(assetError);
  else if (SELFTEST) await paintTiming().catch((e: unknown) => fail(`Paint timing: ${message(e)}`));
  bootFlow();
}

void boot();
