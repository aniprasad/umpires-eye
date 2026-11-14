// Reading the dataset's files for the CLIs. A missing file or text that isn't JSON is a plain Error naming the file,
// which the CLIs print as one line, rather than a stack trace from the file system or the parser.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readText(root: string, rel: string): string {
  const file = join(root, rel);

  if (!existsSync(file)) throw new Error(`${rel} is missing`);

  return readFileSync(file, 'utf8');
}

export function parseJson(text: string, file: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${file} isn't JSON`);
  }
}
