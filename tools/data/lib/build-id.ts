// The build id (docs/M2-DESIGN.md §4.3): the start of a sha256 over the shards and stats as they are before the id is
// stamped in. It names their content, so a rebuild from the same inputs keeps it, and data:daily writing the manifest's
// daily block leaves it alone.
import { createHash } from 'node:crypto';

const ID_HEX = 12;

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** The id of a build whose shards and stats, unstamped and in order, are these texts. */
export function buildIdOf(unstampedTexts: readonly string[]): string {
  return sha256(unstampedTexts.map((t) => `${sha256(t)}\n`).join('')).slice(0, ID_HEX);
}

/**
 * A stamped file as it was before the stamp, or null when it doesn't carry this id. Every file keeps the id right after
 * its season: written compactly in shards and month files, and indented in stats and the manifest.
 */
export function unstamped(text: string, build: string): string | null {
  for (const stamp of [`"build":${JSON.stringify(build)},`, `\n  "build": ${JSON.stringify(build)},`]) {
    const at = text.indexOf(stamp);

    if (at >= 0) return text.slice(0, at) + text.slice(at + stamp.length);
  }

  return null;
}
