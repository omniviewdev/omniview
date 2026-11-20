import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The model is pure TypeScript: no React, no DOM, no other tree. A model that imports a framework cannot be run in a worker, in a plain test, or by another UI. Each check is a function over the
// text of a source, and each has a negative control: a text that breaks the rule must be caught by the same function, or the check proves nothing.

const directory = path.dirname(fileURLToPath(import.meta.url));
const sources = readdirSync(directory)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map((name) => ({ name, text: readFileSync(path.join(directory, name), 'utf8') }));

const imports = (text: string): string[] => [...text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'/g)].map((match) => match[1] ?? '');

/** What the model may take from its neighbours in `core`: the tab model's plain data helpers, its route and its modifier rule, and the shell's saver. Nothing from the tree above. */
const NEIGHBOURS = ['../tabs/json', '../tabs/persist', '../tabs/route', '../tabs/types', '../tabs/disposition', '../saver'];

const foreign = (text: string): string[] => imports(text).filter((specifier) => !specifier.startsWith('./') && !NEIGHBOURS.includes(specifier));

const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** A global is a bare name: not a string, not a property (`row.location`), not a comment. */
const browserGlobal = (text: string): string | undefined => {
  const stripped = code(text).replace(/'(?:[^'\\\n]|\\.)*'/g, '\'\'');
  return /(?<![.\w])(?:document|window|navigator|location|localStorage|sessionStorage|requestAnimationFrame|HTMLElement)\b(?!\??\s*:)/.exec(stripped)?.[0];
};

const timer = (text: string): string | undefined => /(?<![.\w])(?:setTimeout|clearTimeout|setInterval|performance|Date\.now)\b/.exec(code(text))?.[0];

const plugin = (text: string): string | undefined => /acme|beta|gamma/i.exec(code(text))?.[0];

describe('the model\'s sources', () => {
  it('import nothing but their own siblings and the plain helpers of core', () => {
    expect(sources.length).toBeGreaterThan(12);
    for (const { name, text } of sources.filter((source) => source.name !== 'testing.ts')) {
      expect({ name, foreign: foreign(text) }).toEqual({ name, foreign: [] });
    }
  });

  it('touch no browser global: no document, window, navigator, storage or animation frame', () => {
    for (const { name, text } of sources) {
      expect({ name, found: browserGlobal(text) }).toEqual({ name, found: undefined });
    }
  });

  it('read no timer but the scheduler they are given, and the platform\'s only as its default', () => {
    for (const { name, text } of sources.filter((source) => !['store.ts', 'testing.ts', 'types.ts'].includes(source.name))) {
      expect({ name, found: timer(text) }).toEqual({ name, found: undefined });
    }
  });

  it('keep test support out of the model', () => {
    for (const { name, text } of sources.filter((source) => source.name !== 'testing.ts')) {
      expect({ name, usesTesting: imports(text).some((specifier) => specifier.includes('testing')) }).toEqual({ name, usesTesting: false });
    }
  });

  it('know no plugin: the only owner the model names is the host\'s', () => {
    for (const { name, text } of sources.filter((source) => source.name !== 'testing.ts')) {
      expect({ name, plugin: plugin(text) }).toEqual({ name, plugin: undefined });
    }
  });
});

describe('negative controls: each check catches what it is named for', () => {
  it('a framework import is foreign, and so is a tree above the shell', () => {
    expect(foreign('import { useState } from \'react\';')).toEqual(['react']);
    expect(foreign('import { x } from \'../../tabs/store\';\nimport { y } from \'./types\';')).toEqual(['../../tabs/store']);
    expect(foreign('import type { Json } from \'../tabs/types\';')).toEqual([]);
  });

  it('a browser global is found, and a property or a string of the same name is not', () => {
    expect(browserGlobal('const x = document.body;')).toBe('document');
    expect(browserGlobal('const y = window;')).toBe('window');
    expect(browserGlobal('const z = row.location;')).toBeUndefined();
    expect(browserGlobal('const s = \'document\';')).toBeUndefined();
    expect(browserGlobal('// the document of the window')).toBeUndefined();
  });

  it('a timer of the platform is found, and the scheduler\'s is not', () => {
    expect(timer('setTimeout(run, 10);')).toBe('setTimeout');
    expect(timer('const t = Date.now();')).toBe('Date.now');
    expect(timer('scheduler.setTimeout(run, 10);')).toBeUndefined();
  });

  it('a plugin\'s name is found', () => {
    expect(plugin('const owner = \'acme\';')).toBe('acme');
    expect(plugin('const owner = \'cloud\';')).toBeUndefined();
  });
});
