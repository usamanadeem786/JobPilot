import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No source file may contain a raw control character.
 *
 * This exists because the failure it catches has happened three times in this
 * repository, is invisible in every editor and diff, and does not fail the
 * build. Writing a regex through a tool that processes escape sequences turns
 * `\b` into a literal backspace (0x08) and `\t` into a tab: the pattern still
 * compiles, still passes review, and silently stops matching what it says it
 * matches. One such corruption disabled a word boundary in the CV parser; a
 * second wrote backspaces into a filename sanitiser; a third mangled company
 * name normalisation.
 *
 * Tabs and newlines are permitted — the rest have no business in source.
 */

const REPOSITORY_ROOT = resolve(__dirname, '../../..');

const SKIP_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  '.next',
  '.git',
  '.turbo',
  'coverage',
  'build',
  'storage',
]);

const CHECKED_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.prisma', '.md'];

/** Anything below 0x20 except tab (0x09) and newline (0x0a), plus DEL. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\u0000-\u0008\u000b-\u001f\u007f]/;

function* sourceFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;

    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      yield* sourceFiles(path);
      continue;
    }

    if (CHECKED_EXTENSIONS.some((extension) => entry.endsWith(extension))) yield path;
  }
}

describe('source hygiene', () => {
  it('contains no stray control characters', () => {
    const offenders: string[] = [];

    for (const path of sourceFiles(REPOSITORY_ROOT)) {
      // This file necessarily describes the characters it forbids.
      if (path.endsWith('source-hygiene.test.ts')) continue;

      const contents = readFileSync(path, 'utf8');
      if (!CONTROL_CHARACTER.test(contents)) continue;

      const line = contents
        .split('\n')
        .findIndex((candidate) => CONTROL_CHARACTER.test(candidate));

      offenders.push(`${path.slice(REPOSITORY_ROOT.length + 1)}:${line + 1}`);
    }

    expect(offenders, `Control characters found. A regex escape was almost certainly eaten:\n${offenders.join('\n')}`).toEqual([]);
  });
});
