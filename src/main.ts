import backdropWideUrl from './assets/img/backdrop-wide.webp';
import backdropUrl from './assets/img/backdrop.webp';
import batterUrl from './assets/img/batter.webp';
import { worldSeriesSource } from './data/ws2026';
import { bootFlow, wireInput } from './game/flow';
import { SELFTEST } from './game/params';
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
  UI.startLede.textContent = "The pitches didn't load, so there's nothing to call yet. Check your connection, then reload the page.";
  UI.btnPlay.textContent = "Couldn't load the pitches";
  document.documentElement.dataset.ready = 'error';
}

async function boot(): Promise<void> {
  sizeCanvases(UI.scene);
  wireInput();
  // the images load while the pitches do; a failure comes back as a message rather than an unhandled rejection
  const assets = Promise.all([
    loadImg(IMG.backdrop, backdropWideUrl).then(
      () => { IMG.bd = BACKDROPS.wide; },
      () => loadImg(IMG.backdrop, backdropUrl).then(() => { IMG.bd = BACKDROPS.old; }),
    ),
    CARD.art.decode().catch(() => null),
    // if the photo fails, the procedural batter stands in
    loadImg(IMG.bat, batterUrl).catch(() => null),
    document.fonts ? document.fonts.load('800 32px "Big Shoulders Display"').catch(() => null) : null,
  ]).then(() => '', message);

  try {
    setWorld(createWorld(await worldSeriesSource(`${import.meta.env.BASE_URL}data/ws-2026/pool.json`).load()));
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
