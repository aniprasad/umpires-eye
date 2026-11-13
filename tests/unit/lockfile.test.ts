import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../scripts/check-lockfile.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'ue-lockfile-'));

function check(packages: Record<string, object>): { code: number; out: string } {
  const file = join(dir, 'package-lock.json');

  writeFileSync(file, JSON.stringify({ lockfileVersion: 3, packages }));
  try {
    return { code: 0, out: execFileSync(process.execPath, [script, file], { encoding: 'utf8', stdio: 'pipe' }) };
  } catch (e) {
    const err = e as { status: number; stderr: string };

    return { code: err.status, out: err.stderr };
  }
}

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('check:lockfile', () => {
  it('passes a lockfile without resolved URLs, or with npmjs ones', () => {
    expect(check({ 'node_modules/a': { version: '1.0.0', integrity: 'sha512-x' } }).code).toBe(0);
    expect(check({ 'node_modules/a': { resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz' } }).code).toBe(0);
  });

  it('fails on any other registry and names the package', () => {
    const r = check({ 'node_modules/a': { resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz' }, 'node_modules/b': { resolved: 'https://mirror.example.com/npm/b/-/b-2.0.0.tgz' } });

    expect(r.code).toBe(1);
    expect(r.out).toContain('node_modules/b');
    expect(r.out).not.toContain('node_modules/a');
  });
});
