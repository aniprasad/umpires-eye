// Fails when package-lock.json resolves a package anywhere but registry.npmjs.org. A private mirror's URLs would leak
// into the repo and break installs for everyone else; the repo .npmrc keeps them out, and this catches a slip.
// Usage: node scripts/check-lockfile.mjs [path/to/package-lock.json]
import { readFileSync } from 'node:fs';

const NPMJS = 'https://registry.npmjs.org/';
const file = process.argv[2] || new URL('../package-lock.json', import.meta.url);
const bad = [];

function walk(node, path) {
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'resolved' && typeof value === 'string') {
      if (!value.startsWith(NPMJS)) bad.push(`${path || '(root)'}: ${value}`);
    } else walk(value, path ? `${path} > ${key}` : key);
  }
}

walk(JSON.parse(readFileSync(file, 'utf8')), '');
if (bad.length) {
  console.error(`package-lock.json resolves ${bad.length} package(s) outside ${NPMJS}:`);
  for (const line of bad.slice(0, 20)) console.error(`  ${line}`);
  if (bad.length > 20) console.error(`  ... and ${bad.length - 20} more`);
  console.error('Reinstall with the repo .npmrc, which keeps resolved URLs out of the lockfile.');
  process.exit(1);
}
console.log(`package-lock.json: no resolved URLs outside ${NPMJS}`);
