import { describe, expect, it } from 'vitest';
import { readKeywords, SIDEBAR_KEYWORD_LIMITS } from './sidebarKeywords';

// Admission of the keywords a sidebar node carries (C1e). A node is plugin data, and so is what a sidebar hook answers on every render; the keywords are read once, word by word, into a clean list or a
// problem that names the node and the rule. Nothing here throws on what a plugin hands over, and a keyword that is not valid costs the node that keyword and no other, never the node, the sidebar or the plugin.

const node = (keywords: unknown, id = 'racks'): Record<string, unknown> => ({ id, label: 'Racks', icon: 'box', keywords });

const NOT_A_WORD = 'is not a word of 1 to 32 characters, with no white space in it: it is left out';

describe('readKeywords', () => {
  it('reads the words of a node in its own order, each once whatever its case', () => {
    expect(readKeywords(node(['Rack', 'rk', 'RK', 'rack']))).toEqual({ words: ['Rack', 'rk'], problems: [] });
  });

  it('has nothing to read, and nothing to say, for a node with no keywords: an older plugin, or one with none to give', () => {
    expect(readKeywords(node(undefined))).toEqual({ words: [], problems: [] });
    expect(readKeywords({ id: 'x', label: 'X', icon: 'box' })).toEqual({ words: [], problems: [] });
    expect(readKeywords(node([]))).toEqual({ words: [], problems: [] });
  });

  it('takes a word as it is trimmed, and nothing with white space inside: a keyword is one word', () => {
    expect(readKeywords(node(['  rk  ', 'config map', 'a\tb', 'cm']))).toEqual({
      words: ['rk', 'cm'],
      problems: [`sidebar entry "racks": keyword 2 ${NOT_A_WORD}`, `sidebar entry "racks": keyword 3 ${NOT_A_WORD}`],
    });
  });

  it('leaves out what is not a word of at most 32 characters, with a problem that names the node and the place, and keeps the rest', () => {
    const long = 'x'.repeat(SIDEBAR_KEYWORD_LIMITS.length + 1);
    const read = readKeywords(node(['rk', '', '   ', 3, null, undefined, { rk: 1 }, ['rk'], long, 'x'.repeat(SIDEBAR_KEYWORD_LIMITS.length), 'cm']));
    expect(read.words).toEqual(['rk', 'x'.repeat(SIDEBAR_KEYWORD_LIMITS.length), 'cm']);
    expect(read.problems).toHaveLength(4);
    expect(read.problems[0]).toBe(`sidebar entry "racks": keyword 2 ${NOT_A_WORD}`);
    expect(read.problems.at(-1)).toMatch(/^and \d+ more keywords that are not valid$/);
  });

  it('says the problems of a node once for each, at most four lines: a node that is wrong in many places does not fill a log', () => {
    const read = readKeywords(node(Array.from({ length: 6 }, () => 1)));
    expect(read.words).toEqual([]);
    expect(read.problems).toEqual([`sidebar entry "racks": keyword 1 ${NOT_A_WORD}`, `sidebar entry "racks": keyword 2 ${NOT_A_WORD}`, `sidebar entry "racks": keyword 3 ${NOT_A_WORD}`, 'and 3 more keywords that are not valid']);
  });

  it('keeps at most eight, the first eight, and says the rest are left out', () => {
    const many = Array.from({ length: 12 }, (_, index) => `k${String(index)}`);
    expect(readKeywords(node(many))).toEqual({ words: many.slice(0, SIDEBAR_KEYWORD_LIMITS.count), problems: ['sidebar entry "racks": more than 8 keywords: the rest are left out'] });
    expect(readKeywords(node(many.slice(0, 8)))).toEqual({ words: many.slice(0, 8), problems: [] });
  });

  it('counts a word that is a duplicate as no word and no problem: it is the same name said twice', () => {
    const many = ['a', 'A', 'b', 'a', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    expect(readKeywords(node(many))).toEqual({ words: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], problems: ['sidebar entry "racks": more than 8 keywords: the rest are left out'] });
  });

  it('refuses what is not a list: a string, a number, an object, null', () => {
    for (const keywords of ['rk', 3, { 0: 'rk', length: 1 }, null, true]) {
      expect(readKeywords(node(keywords)), JSON.stringify(keywords)).toEqual({ words: [], problems: ['sidebar entry "racks": keywords is not a list of words: it is left out'] });
    }
  });

  it('looks at a bounded number of entries, whatever the list holds: a million words cost a few reads', () => {
    let reads = 0;
    const huge = new Proxy(Array.from({ length: 1_000_000 }, (_, index) => `w${String(index)}`), {
      get: (target, name, receiver) => {
        if (typeof name === 'string' && /^\d+$/.test(name)) {
          reads += 1;
        }

        return Reflect.get(target, name, receiver) as unknown;
      },
    });
    const read = readKeywords(node(huge));
    expect(read.words).toHaveLength(SIDEBAR_KEYWORD_LIMITS.count);
    expect(read.problems).toEqual(['sidebar entry "racks": more than 8 keywords: the rest are left out']);
    expect(reads).toBeLessThanOrEqual(SIDEBAR_KEYWORD_LIMITS.count * 4);
  });

  it('looks at a bounded number of entries even when none of them is a word: a million entries that are not words cost the scan and no more, and the rest are said to be left out', () => {
    let reads = 0;
    const huge = new Proxy(Array.from({ length: 1_000_000 }, () => 3), {
      get: (target, name, receiver) => {
        if (typeof name === 'string' && /^\d+$/.test(name)) {
          reads += 1;
        }

        return Reflect.get(target, name, receiver) as unknown;
      },
    });
    const read = readKeywords(node(huge));
    expect(read.words).toEqual([]);
    expect(reads).toBe(SIDEBAR_KEYWORD_LIMITS.scan);
    expect(read.problems).toHaveLength(5);
    expect(read.problems[3]).toBe(`and ${String(SIDEBAR_KEYWORD_LIMITS.scan - 3)} more keywords that are not valid`);
    expect(read.problems[4]).toBe('sidebar entry "racks": more than 8 keywords: the rest are left out');
  });

  it('says the rest of a list longer than the scan is left out even when what was read held few words: the same word forty times', () => {
    const read = readKeywords(node(Array.from({ length: SIDEBAR_KEYWORD_LIMITS.scan + 8 }, () => 'rk')));
    expect(read).toEqual({ words: ['rk'], problems: ['sidebar entry "racks": more than 8 keywords: the rest are left out'] });
  });

  it('does not read a text of any length: a megabyte string is a keyword that is too long, and was not looked into', () => {
    const read = readKeywords(node(['rk', 'x'.repeat(1_000_000)]));
    expect(read.words).toEqual(['rk']);
    expect(read.problems).toEqual([`sidebar entry "racks": keyword 2 ${NOT_A_WORD}`]);
  });

  it('never throws on what a plugin hands over: a getter that throws, a list that throws when read, a node that is not an object', () => {
    const hostile = {
      id: 'rk',
      get keywords(): unknown {
        throw new Error('no');
      },
    };
    expect(readKeywords(hostile)).toEqual({ words: [], problems: ['sidebar entry "rk": keywords could not be read: it is left out'] });

    const list = Object.defineProperty(['a', 'b'], '1', {
      get: () => {
        throw new Error('no');
      },
    });
    expect(readKeywords(node(list))).toEqual({ words: [], problems: ['sidebar entry "racks": keywords could not be read: it is left out'] });

    for (const bad of [undefined, null, 3, 'text', []]) {
      expect(readKeywords(bad), JSON.stringify(bad)).toEqual({ words: [], problems: [] });
    }
  });

  it('never throws on an id that cannot be read either: the problem names the node as an entry', () => {
    const hostile = {
      get id(): unknown {
        throw new Error('no');
      },
      keywords: ['rk', 'two words'],
    };
    expect(readKeywords(hostile)).toEqual({ words: ['rk'], problems: [`a sidebar entry: keyword 2 ${NOT_A_WORD}`] });
  });

  it('names a node by its id, bounded, or says only that it is an entry when it has none a log could use', () => {
    expect(readKeywords(node('rk', 'x'.repeat(200))).problems[0]).toBe(`sidebar entry "${'x'.repeat(64)}": keywords is not a list of words: it is left out`);
    expect(readKeywords({ keywords: 'rk' }).problems[0]).toBe('a sidebar entry: keywords is not a list of words: it is left out');
    expect(readKeywords({ id: 3, keywords: 'rk' }).problems[0]).toBe('a sidebar entry: keywords is not a list of words: it is left out');
  });

  it('gives lists nobody can change afterwards, and leaves the plugin\'s own alone', () => {
    const own = ['rk', 'cm'];
    const read = readKeywords(node(own));
    expect(Object.isFrozen(read)).toBe(true);
    expect(Object.isFrozen(read.words)).toBe(true);
    expect(Object.isFrozen(read.problems)).toBe(true);
    expect(own).toEqual(['rk', 'cm']);
    expect(Object.isFrozen(own)).toBe(false);
  });
});
