import backdropWideUrl from './assets/img/backdrop-wide.webp';
import backdropUrl from './assets/img/backdrop.webp';
import batterUrl from './assets/img/batter.webp';
import { dateKeyOf } from './core/daily.ts';
import { openSource, sourceIdOf } from './data/sources';
import { bootFlow, dataFailed, wireInput } from './game/flow';
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
    const source = await openSource(sourceIdOf(POOL, SELFTEST), import.meta.env.BASE_URL);

    // The stats load alongside today's files (§4.1). Play never waits for them; T11 shows the figure.
    void source.umpFigure();
    // a date without a Ten is no failure: the start screen offers Another ten (NoToday)
    setWorld(createWorld(source, await source.today(DATE ?? dateKeyOf(new Date()))));
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
