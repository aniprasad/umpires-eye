// npm run e2e: Playwright's test runner, holding the machine's e2e run lock (scripts/e2e-lock.ts) from before the
// build until the last browser closes. Arguments pass through: npm run e2e -- --project=desktop-webkit
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { acquireLock, shouldLock } from './e2e-lock.ts';

const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
let child: ChildProcess | null = null;

function playwright(): Promise<number> {
  return new Promise((resolve) => {
    child = spawn(process.execPath, [cli, 'test', ...process.argv.slice(2)], { stdio: 'inherit' });
    child.on('error', (e) => {
      console.error(`e2e: couldn't start Playwright: ${e.message}`);
      resolve(1);
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    // Ctrl+C reaches Playwright too, and it stops its server before exiting; the lock goes once it has. Other signals
    // reach only this process, so they're passed on.
    if (!child) process.exit(130);
    else if (signal !== 'SIGINT') child.kill(signal);
  });
}

if (shouldLock(process.env)) {
  let release: () => void;

  try {
    release = await acquireLock({ port: Number(process.env.UE_E2E_PORT || 4173) });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  process.on('exit', release);
}
process.exitCode = await playwright();
