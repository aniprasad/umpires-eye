import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { acquireLock, shouldLock, type Holder } from '../../scripts/e2e-lock.ts';

const dir = mkdtempSync(join(tmpdir(), 'ue-e2e-lock-'));
let n = 0;

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A fresh lock path, and a clock that only moves when the lock sleeps; `at` runs a step once the clock reaches it. */
function setup() {
  const file = join(dir, `lock-${n++}`);
  const lines: string[] = [];
  const steps: Array<{ t: number; run: () => void; done?: boolean }> = [];
  const t0 = Date.parse('2026-11-13T09:00:00Z');
  let t = t0;

  return {
    file,
    lines,
    at: (ms: number, run: () => void) => steps.push({ t: t0 + ms, run }),
    hold: (h: Partial<Holder>) => writeFileSync(file, JSON.stringify({ pid: 111, port: 4201, started: '2026-11-13T08:55:00Z', ...h })),
    holder: (): Holder => JSON.parse(readFileSync(file, 'utf8')) as Holder,
    opts: {
      file,
      pid: 222,
      port: 4210,
      log: (line: string) => lines.push(line),
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
        for (const step of steps) {
          if (!step.done && step.t <= t) {
            step.done = true;
            step.run();
          }
        }
      },
    },
  };
}

describe('the e2e run lock', () => {
  it('takes a free lock, records its pid, port and start time, and releases it', async () => {
    const s = setup();
    const release = await acquireLock({ ...s.opts, alive: () => true });

    expect(s.holder()).toEqual({ pid: 222, port: 4210, started: '2026-11-13T09:00:00.000Z' });
    expect(s.lines).toEqual([]);
    release();
    expect(existsSync(s.file)).toBe(false);
  });

  it('waits while a live run holds it, logging every 30 s, and takes it once that run is done', async () => {
    const s = setup();

    s.hold({});
    s.at(75_000, () => rmSync(s.file));
    await acquireLock({ ...s.opts, alive: () => true });

    expect(s.holder().pid).toBe(222);
    expect(s.lines).toHaveLength(3);
    expect(s.lines[0]).toMatch(/^e2e: waiting for the e2e run on port 4201 \(pid 111, started .+\) to finish/);
    expect(s.lines[1]).toMatch(/still waiting for .*pid 111.*, 30 s so far/);
    expect(s.lines[2]).toMatch(/still waiting for .*pid 111.*, 1 min so far/);
  });

  it('takes over a lock whose run has died', async () => {
    const s = setup();

    s.hold({ pid: 333 });
    await acquireLock({ ...s.opts, alive: (pid) => pid !== 333 });

    expect(s.holder().pid).toBe(222);
    expect(s.lines).toEqual([expect.stringMatching(/pid 333.* is no longer running; taking over its lock/)]);
    expect(readdirSync(dir).filter((f) => f.startsWith(`${basename(s.file)}.`))).toEqual([]);
  });

  it('puts back a lock another run took after this one found the old holder dead, and waits for it', async () => {
    const s = setup();
    const alive = (pid: number): boolean => {
      // A faster waiter takes over the same dead lock just before this run moves it aside.
      if (pid === 333) s.hold({ pid: 555, port: 4202, started: '2026-11-13T09:00:00Z' });

      return pid !== 333;
    };

    s.hold({ pid: 333 });
    s.at(1000, () => {
      expect(s.holder().pid).toBe(555);
      rmSync(s.file);
    });
    await acquireLock({ ...s.opts, alive });

    expect(s.holder().pid).toBe(222);
    expect(s.lines).toEqual([
      expect.stringMatching(/pid 333.* is no longer running; taking over its lock/),
      expect.stringMatching(/^e2e: waiting for the e2e run on port 4202 \(pid 555, /),
    ]);
    expect(readdirSync(dir).filter((f) => f.startsWith(`${basename(s.file)}.`))).toEqual([]);
  });

  it('replaces a file that isn\'t a lock', async () => {
    const s = setup();

    writeFileSync(s.file, 'not json');
    await acquireLock({ ...s.opts, alive: () => true });

    expect(s.holder().pid).toBe(222);
  });

  it('gives up after 20 minutes, naming the run that holds it and the file to delete', async () => {
    const s = setup();

    s.hold({});
    await expect(acquireLock({ ...s.opts, pollMs: 10_000, alive: () => true })).rejects.toThrow(
      /^e2e: gave up after 20 min: the e2e run on port 4201 \(pid 111, .*\) still holds the lock\..* delete .*lock-\d+ and try again\.$/,
    );
    expect(s.holder().pid).toBe(111);
    expect(s.lines).toHaveLength(40);
  });

  it("leaves another run's lock alone on release", async () => {
    const s = setup();
    const release = await acquireLock({ ...s.opts, alive: () => true });

    s.hold({ pid: 444 });
    release();
    expect(s.holder().pid).toBe(444);
  });

  it('is skipped on CI', () => {
    expect(shouldLock({ CI: 'true' })).toBe(false);
    expect(shouldLock({})).toBe(true);
  });
});
