import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('../../../', import.meta.url)) });
const CORE_RULES = new Set(['no-restricted-imports', 'no-restricted-syntax', 'no-restricted-globals']);

/** The core-fence rules a snippet breaks, linted as if it were a file at `path`. */
async function broken(code: string, path = 'src/core/probe.ts'): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path });

  return (result?.messages ?? []).flatMap((m) => (m.ruleId && CORE_RULES.has(m.ruleId) ? [m.ruleId] : []));
}

describe('lint keeps src/core pure and importable by plain Node', () => {
  it('accepts a sibling import spelled with its extension', async () => {
    expect(await broken("import { hash32 } from './rng.ts';\n\nexport const h = hash32('x');\n")).toEqual([]);
  });

  it('rejects a relative import or re-export without .ts', async () => {
    expect(await broken("import { hash32 } from './rng';\n\nexport const h = hash32('x');\n")).toEqual(['no-restricted-syntax']);
    expect(await broken("export { hash32 } from './rng';\n")).toEqual(['no-restricted-syntax']);
    expect(await broken("export * from './rng';\n")).toEqual(['no-restricted-syntax']);
  });

  it('rejects imports from outside core: app code, packages and Node modules', async () => {
    expect(await broken("import { prep } from '../math/kinematics.ts';\n\nexport const p = prep;\n")).toEqual(['no-restricted-imports']);
    expect(await broken("import { readFileSync } from 'node:fs';\n\nexport const r = readFileSync;\n")).toEqual(['no-restricted-imports']);
    expect(await broken("import { defineConfig } from 'vite';\n\nexport const d = defineConfig;\n")).toEqual(['no-restricted-imports']);
  });

  it('rejects import.meta.env, Math.random and DOM or Node globals', async () => {
    expect(await broken('export const base = import.meta.env.BASE_URL;\n')).toEqual(['no-restricted-syntax']);
    expect(await broken('export const r = Math.random();\n')).toEqual(['no-restricted-syntax']);
    expect(await broken('export const w = window.innerWidth;\n')).toEqual(['no-restricted-globals']);
    expect(await broken('export const e = process.env.CI;\n')).toEqual(['no-restricted-globals']);
  });

  it('leaves the app outside core alone', async () => {
    expect(await broken('export const r = Math.random() + window.innerWidth;\n', 'src/game/probe.ts')).toEqual([]);
  });
});
