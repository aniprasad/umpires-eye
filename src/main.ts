import backdropWideUrl from './assets/img/backdrop-wide.webp';
import backdropUrl from './assets/img/backdrop.webp';
import batterUrl from './assets/img/batter.webp';
import { dateKeyOf } from './core/daily.ts';
import type { PitchSource, TodayResult } from './data/source';
import { openSource, sourceIdOf } from './data/sources';
import { isWorldSeries } from './data/ws2026';
import { bootFlow, dataFailed, wireInput } from './game/flow';
import { DATE, POOL, SELFTEST } from './game/params';
import { createWorld, setWorld } from './game/state';
import { showFailure, showLoading } from './game/states';
import { BACKDROPS } from './render/backdrop';
import { IMG, sizeCanvases } from './render/env';
import { paintTiming, showSelfTest } from './selftest/page';
import { showCardFigure } from './ui/card';
import { CARD, fail, UI } from './ui/dom';
import { showFigure } from './ui/hud';

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// Every module has loaded, so the error listeners in index.html leave the start screen to the app from here on.
dispatchEvent(new Event('ue:running'));

const loadImg = (img: HTMLImageElement, src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error(`Could not load ${src}`));
  img.src = src;
});

/** The season's Ten for a date, with the start screen Loading meanwhile, and Failed or Broken until it loads (§5.1). */
async function seasonToday(source: PitchSource, dateKey: string): Promise<TodayResult> {
  for (;;) {
    showLoading();
    try {
      return await source.today(dateKey);
    } catch (e) {
      await showFailure(e);
    }
  }
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
    const source = await openSource(sourceIdOf(POOL, SELFTEST), import.meta.env.BASE_URL);
    // The stats load alongside today's files (§4.1). Play never waits for them; the figure shows when they come.
    const figure = source.umpFigure();
    const dateKey = DATE ?? dateKeyOf(new Date());

    // a date without a Ten is no failure: the start screen offers Another ten (NoToday)
    setWorld(createWorld(source, isWorldSeries(source) ? await source.today(dateKey) : await seasonToday(source, dateKey)));
    // a card can be up before the figure, as ?state=card's can, so it takes the figure too
    void figure.then((f) => {
      showFigure(f);
      showCardFigure(f);
    });
  } catch (e) {
    // only the World Series loads anything before it opens, and it keeps M1's failure
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
