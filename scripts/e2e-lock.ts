// The run lock behind npm run e2e. Full Playwright runs on one machine take turns, whatever ports they use, so one
// run's browsers can't slow another's into timeouts. Runs from every checkout share one file in the OS temp folder.
import { linkSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const LOCK_FILE = join(tmpdir(), 'umpires-eye-e2e.lock');

export interface Holder {
  pid: number;
  port: number;
  /** ISO time the run took the lock. */
  started: string;
}

export interface LockOptions {
  port: number;
  file?: string;
  pid?: number;
  /** How long to wait for other runs before giving up. */
  waitMs?: number;
  pollMs?: number;
  logEveryMs?: number;
  alive?: (pid: number) => boolean;
  log?: (line: string) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** CI runners are fresh machines with one run each. */
export const shouldLock = (env: Record<string, string | undefined>): boolean => !env.CI;

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (e) {
    // EPERM: the process exists but belongs to someone else.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readText(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function parseHolder(text: string | null): Holder | null {
  try {
    const h = JSON.parse(text ?? '') as Partial<Holder>;

    return Number.isInteger(h.pid) && typeof h.started === 'string' ? { pid: h.pid as number, port: Number(h.port), started: h.started } : null;
  } catch {
    return null;
  }
}

/** Creates the lock with its whole content at once: a hard link either appears complete or fails because one exists. */
function tryCreate(file: string, text: string, pid: number): boolean {
  const tmp = `${file}.${pid}.tmp`;

  writeFileSync(tmp, text);
  try {
    linkSync(tmp, file);

    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;

    if (code === 'EEXIST') return false;
    if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'ENOSYS') throw e;
    // A file system without hard links: an exclusive create is the next best thing.
    try {
      writeFileSync(file, text, { flag: 'wx' });

      return true;
    } catch (e2) {
      if ((e2 as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw e2;
    }
  } finally {
    rmSync(tmp, { force: true });
  }
}

const clock = (iso: string): string => {
  const d = new Date(iso);

  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString('en-GB');
};

const minutes = (ms: number): string => {
  const s = Math.round(ms / 1000);

  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`;
};

const who = (h: Holder): string => `the e2e run on port ${h.port} (pid ${h.pid}, started ${clock(h.started)})`;

/** Removes the lock if this run still holds it; another run's lock is left alone. */
export function releaseLock(file: string, pid: number): void {
  if (parseHolder(readText(file))?.pid === pid) rmSync(file, { force: true });
}

/**
 * Takes the lock, waiting while a live run holds it. A lock whose run has died is taken over. Resolves to the release
 * function; rejects once `waitMs` has passed.
 */
export async function acquireLock(o: LockOptions): Promise<() => void> {
  const file = o.file ?? LOCK_FILE;
  const pid = o.pid ?? process.pid;
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const alive = o.alive ?? pidAlive;
  const log = o.log ?? ((line: string) => console.log(line));
  const waitMs = o.waitMs ?? 20 * 60_000;
  const pollMs = o.pollMs ?? 1000;
  const logEveryMs = o.logEveryMs ?? 30_000;
  const t0 = now();
  const mine = JSON.stringify({ pid, port: o.port, started: new Date(t0).toISOString() } satisfies Holder);
  let lastLog = -Infinity;

  for (;;) {
    if (tryCreate(file, mine, pid)) return () => releaseLock(file, pid);

    const text = readText(file);

    // Released between the two calls: try again at once.
    if (text === null) continue;

    const holder = parseHolder(text);

    if (!holder || !alive(holder.pid)) {
      log(holder ? `e2e: ${who(holder)} is no longer running; taking over its lock.` : `e2e: ${file} isn't a lock this script wrote; replacing it.`);
      // Two waiters can find the same dead holder. Each moves the file aside under its own name and then reads what it
      // moved, so the slower one can't delete the lock the faster one has just taken: it puts that lock back instead.
      const aside = `${file}.${pid}.stale`;

      try {
        renameSync(file, aside);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw e;
      }

      const moved = readText(aside);

      if (moved !== null && moved !== text) tryCreate(file, moved, pid);
      rmSync(aside, { force: true });
      continue;
    }

    const waited = now() - t0;

    if (waited >= waitMs) {
      throw new Error(
        `e2e: gave up after ${minutes(waitMs)}: ${who(holder)} still holds the lock. Full runs take turns on this machine. If no e2e run is going, delete ${file} and try again.`,
      );
    }
    if (now() - lastLog >= logEveryMs) {
      log(lastLog === -Infinity
        ? `e2e: waiting for ${who(holder)} to finish; full runs take turns on this machine.`
        : `e2e: still waiting for ${who(holder)}, ${minutes(waited)} so far.`);
      lastLog = now();
    }
    await sleep(pollMs);
  }
}
