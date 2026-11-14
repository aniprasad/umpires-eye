// The build id: the start of a sha256 over the shards and stats as they are before the id is
// stamped in. It names their content, so a rebuild from the same inputs keeps it, and data:daily writing the manifest's
// daily block leaves it alone.
import { createHash } from 'node:crypto';
import { SEASON } from '../../../src/core/rules.ts';

const ID_HEX = 12;

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** The id of a build whose shards and stats, unstamped and in order, are these texts. */
export function buildIdOf(unstampedTexts: readonly string[]): string {
  return sha256(unstampedTexts.map((t) => `${sha256(t)}\n`).join('')).slice(0, ID_HEX);
}

/**
 * A shard or stats.json as it was before the stamp, or null when this id isn't stamped where data:build puts it: right
 * after the season, written compactly in shards and indented in stats.
 */
export function unstamped(text: string, build: string): string | null {
  const id = JSON.stringify(build);
  const forms: ReadonlyArray<readonly [string, string]> = [
    [`"season":${SEASON},`, `"build":${id},`],
    [`\n  "season": ${SEASON},`, `\n  "build": ${id},`],
  ];

  for (const [season, stamp] of forms) {
    const at = text.indexOf(season + stamp);

    if (at >= 0) return text.slice(0, at + season.length) + text.slice(at + season.length + stamp.length);
  }

  return null;
}

/**
 * What data:validate finds wrong with the id stamped in the shards and stats.json, given by name in the build's order.
 * A file whose stamp can't be taken out fails rather than being skipped: stats.json has no hash in the manifest, so
 * without a rebuild this is the only check that covers all of it.
 */
export function buildIdProblems(build: string, files: ReadonlyArray<readonly [string, string]>): string[] {
  const texts: string[] = [];
  const lost: string[] = [];

  for (const [name, text] of files) {
    const bare = unstamped(text, build);

    if (bare === null) lost.push(`${name} doesn't carry build ${build} right after its season, so the id can't be recomputed`);
    else texts.push(bare);
  }
  if (lost.length) return lost;

  const id = buildIdOf(texts);

  return id === build ? [] : [`the build id ${build} isn't the hash of the shards and stats, which is ${id}`];
}
