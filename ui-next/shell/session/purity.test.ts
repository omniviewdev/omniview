import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The session module is plain TypeScript over the two models: no React, no runtime, no other tree. The runtime's binding is handed to it (`window.ts` takes the client), so it can be run in a plain
// test and by any host; the one file that touches the page (`lifecycle.ts`) is the one place a browser global is named.

const directory = path.dirname(fileURLToPath(import.meta.url));
const sources = readdirSync(directory)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'testing.ts')
  .map((name) => ({ name, text: readFileSync(path.join(directory, name), 'utf8') }));

const imports = (text: string) => [...text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'/g)].map((match) => match[1] ?? '');
/** The code without its comments and the words of its strings, single-quoted or template: a note that says "this window" names no global. */
const code = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, '\'\'')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');

/** What the session takes from the models: their public entries and the shell's saver. Nothing from the tree above them. */
const NEIGHBOURS = ['../core/tabs', '../core/panel', '../core/saver'];

describe('the session module\'s sources', () => {
  it('import nothing but their own siblings, the two models and the saver', () => {
    expect(sources.length).toBeGreaterThan(4);
    for (const { name, text } of sources) {
      const foreign = imports(text).filter((specifier) => !specifier.startsWith('./') && !NEIGHBOURS.includes(specifier));
      expect({ name, foreign }).toEqual({ name, foreign: [] });
    }
  });

  it('touch no browser global but in the lifecycle: no document, window, navigator, storage or animation frame', () => {
    const globals = /(?<![.\w])(?:document|window|navigator|location|localStorage|sessionStorage|requestAnimationFrame|HTMLElement)\b(?!\s*:)/;
    for (const { name, text } of sources.filter((source) => source.name !== 'lifecycle.ts')) {
      expect({ name, found: globals.exec(code(text))?.[0] }).toEqual({ name, found: undefined });
    }
  });

  it('keep test support out of the module, and know no plugin', () => {
    for (const { name, text } of sources) {
      expect({ name, usesTesting: imports(text).some((specifier) => specifier.includes('testing')) }).toEqual({ name, usesTesting: false });
      expect({ name, plugin: /acme|beta|gamma/i.exec(code(text).replace(/\/\/.*$/gm, ''))?.[0] }).toEqual({ name, plugin: undefined });
    }
  });
});
