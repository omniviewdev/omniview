import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The model is pure TypeScript: no React, no DOM, no other tree. A model that imports a framework cannot be run in a worker, in a plain test, or by another UI.

const directory = path.dirname(fileURLToPath(import.meta.url));
const sources = readdirSync(directory)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map((name) => ({ name, text: readFileSync(path.join(directory, name), 'utf8') }));

const imports = (text: string) => [...text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'/g)].map((match) => match[1] ?? '');

describe('the model\'s sources', () => {
  it('depend only on their siblings, the shared saver and the two pure extension ID predicates', () => {
    expect(sources.length).toBeGreaterThan(8);
    for (const { name, text } of sources) {
      const local = name === 'route.ts' ? text.replace('import { isExtensionIdSegment, isExtensionOwnerId } from \'@omniviewdev/runtime/internal/extensions-v1\';', '') : text;
      const foreign = imports(local).filter((specifier) => !specifier.startsWith('./') && specifier !== '../saver');
      expect({ name, foreign }).toEqual({ name, foreign: [] });
    }
  });

  it('touch no browser global: no document, window, navigator, storage or animation frame', () => {
    // A global is a bare name: not a string ('window' is a disposition), not a property (`tab.location`), not a comment.
    const globals = /(?<![.\w])(?:document|window|navigator|location|localStorage|sessionStorage|requestAnimationFrame|HTMLElement)\b(?!\s*:)/;
    for (const { name, text } of sources) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/'(?:[^'\\\n]|\\.)*'/g, '\'\'');
      expect({ name, found: globals.exec(code)?.[0] }).toEqual({ name, found: undefined });
    }
  });

  it('keep test support out of the model', () => {
    for (const { name, text } of sources.filter((source) => source.name !== 'testing.ts')) {
      expect({ name, usesTesting: imports(text).some((specifier) => specifier.includes('testing')) }).toEqual({ name, usesTesting: false });
    }
  });
});
