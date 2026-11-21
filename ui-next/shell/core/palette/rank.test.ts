import { describe, expect, it } from 'vitest';
import { scoreCandidate, wordsOf } from './match';
import { rank } from './rank';
import type { Candidate } from './types';

// Ranking (ch16 SE1): with a query, an exact or prefix match on an object's name outranks a substring or loose match in a command or page title (`cart` puts `cart-api` first, not
// Helm Charts or Install chart; review pack 30). Ties are broken the same way on every machine: the candidate's `order` (or its place in the list the providers gave), then the
// shorter title, then the title and the key by code unit (never by locale, which differs from one machine to the next).

const candidate = (id: string, title: string, extra: Partial<Candidate> = {}): Candidate => ({ id, kind: 'page', title, ...extra });
const titles = (hits: ReadonlyArray<{ readonly candidate: Candidate }>): string[] => hits.map((hit) => hit.candidate.title);
const ids = (hits: ReadonlyArray<{ readonly candidate: Candidate }>): string[] => hits.map((hit) => hit.candidate.id);

/** A small seeded generator, so a failure reads the same on every machine. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

describe('rank, with a query', () => {
  it('puts an object named for the query before a page whose title only holds its letters (SE1: cart before Helm Charts)', () => {
    const list = [
      candidate('charts', 'Charts', { context: 'Helm' }),
      candidate('install', 'Install chart', { context: 'Helm' }),
      candidate('cart-api', 'cart-api', { kind: 'resource', context: 'Deployment · prod-eu · payments' }),
      candidate('overview', 'Cluster overview'),
    ];
    const { hits, total } = rank([{ owner: 'p', candidates: list }], wordsOf('cart'), 10);
    expect(titles(hits)).toEqual(['cart-api', 'Charts', 'Install chart']);
    expect(total).toBe(3);
    expect(hits.map((hit) => hit.score)).toEqual([88 * 6, 41 * 6, 41 * 6]);
  });

  it('ranks a prefix before a word start before a substring, and drops letters that are spread over words', () => {
    const list = [candidate('a', 'zz-cart'), candidate('b', 'zzcartzz'), candidate('c', 'cart-zz'), candidate('d', 'crazy-art-zz')];
    expect(titles(rank([{ owner: 'p', candidates: list }], wordsOf('cart'), 10).hits)).toEqual(['cart-zz', 'zz-cart', 'zzcartzz']);
  });

  it('drops what does not match and counts what does, past the limit', () => {
    const list = Array.from({ length: 100 }, (_, index) => candidate(`n${String(index)}`, `node-${String(index)}`));
    const { hits, total } = rank([{ owner: 'p', candidates: [...list, candidate('x', 'unrelated')] }], wordsOf('node'), 5);
    expect(hits).toHaveLength(5);
    expect(total).toBe(100);
  });

  it('ranks the same whatever order the list is in once every candidate has its own number', () => {
    const base = [
      candidate('1', 'jobs', { order: 0 }),
      candidate('2', 'Jobs', { order: 0 }),
      candidate('3', 'jobs', { order: 5 }),
      candidate('4', 'jobsx', { order: 0 }),
      candidate('5', 'job', { order: 0 }),
      candidate('6', 'job-b', { order: 0 }),
      candidate('7', 'job-a', { order: 0 }),
      candidate('8', 'job-a', { order: 0 }),
    ];
    const next = random(7);
    const expected = ids(rank([{ owner: 'p', candidates: base }], wordsOf('job'), 20).hits);
    expect(expected).toHaveLength(8);
    for (let round = 0; round < 25; round += 1) {
      const shuffled = [...base].sort(() => next() - 0.5);
      expect(ids(rank([{ owner: 'p', candidates: shuffled }], wordsOf('job'), 20).hits)).toEqual(expected);
    }
  });

  it('breaks a tie by the candidate\'s order, then the shorter title, then the title and the key by code unit', () => {
    // No number of their own: the place each has in the list is its number, 0 to 3. The one with -1 leads.
    const placed = [candidate('k2', 'job-b'), candidate('k1', 'job-b'), candidate('s', 'job-aa'), candidate('t', 'job-a'), candidate('o', 'job-zzzzzz', { order: -1 })];
    expect(ids(rank([{ owner: 'p', candidates: placed }], wordsOf('job'), 20).hits)).toEqual(['o', 'k2', 'k1', 's', 't']);
    // The same number for all: the shorter title (job-aa last), then the title by code unit (a capital before a small letter), then the key.
    const bare = [candidate('k2', 'job-b', { order: 0 }), candidate('k1', 'job-b', { order: 0 }), candidate('s', 'job-aa', { order: 0 }), candidate('t', 'job-a', { order: 0 }), candidate('u', 'job-B', { order: 0 })];
    expect(ids(rank([{ owner: 'p', candidates: bare }], wordsOf('job'), 20).hits)).toEqual(['u', 't', 'k1', 'k2', 's']);
  });

  it('ranks across providers as one list and names each hit\'s owner; the place counts across them', () => {
    const hits = rank(
      [
        { owner: 'one', candidates: [candidate('a', 'cart-api')] },
        { owner: 'two', candidates: [candidate('a', 'cart-api'), candidate('b', 'cart')] },
      ],
      wordsOf('cart'),
      10,
    ).hits;
    expect(hits.map((hit) => `${hit.owner}|${hit.candidate.id}`)).toEqual(['two|b', 'one|a', 'two|a']);
  });

  it('is exactly what scoring every candidate, sorting by the rule and keeping the first few gives', () => {
    const next = random(11);
    const alphabet = 'abcdeop -_';
    const text = (length: number) => Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)] ?? 'a').join('');
    const list = Array.from({ length: 800 }, (_, index) => candidate(`id${String(index)}`, text(3 + Math.floor(next() * 12)), { context: text(8), order: index % 7 }));
    const words = wordsOf('o a');
    const naive = list
      .map((item) => ({ item, score: scoreCandidate(words, item) }))
      .filter((hit): hit is { item: Candidate; score: number } => hit.score !== undefined)
      .sort((a, b) => b.score - a.score || (a.item.order ?? 0) - (b.item.order ?? 0) || a.item.title.length - b.item.title.length || (a.item.title < b.item.title ? -1 : a.item.title > b.item.title ? 1 : 0) || (a.item.id < b.item.id ? -1 : 1));
    expect(naive.length).toBeGreaterThan(100);
    for (const limit of [1, 5, 40, 799]) {
      const few = rank([{ owner: 'p', candidates: list }], words, limit);
      expect(ids(few.hits)).toEqual(naive.slice(0, limit).map((hit) => hit.item.id));
      expect(few.total).toBe(naive.length);
    }
  });

  it('never changes a candidate', () => {
    const one = Object.freeze(candidate('a', 'cart-api'));
    expect(rank([{ owner: 'p', candidates: [one] }], wordsOf('cart'), 5).hits[0]?.candidate).toBe(one);
  });
});

// Aliases (C1e; match.ts says what one is): the short name a plugin gives a page, typed whole, ranks with an exact title match, and typed as the start of an alias, with a prefix of a title. The case
// that made the rule is one a plugin found in the real host (C1d), where a two-letter short name gave the pages whose titles hold its letters first and the page it names third.
describe('rank, with aliases', () => {
  const kind = (id: string, title: string, extra: Partial<Candidate> = {}): Candidate => candidate(id, title, { context: 'Acme · Cluster', ...extra });
  const kinds = (named: Partial<Candidate>): Candidate[] => [
    kind('sensors', 'Sensors'),
    kind('pinpointslots', 'PinpointSlots'),
    kind('namesets', 'Namesets', named),
    kind('nodes', 'Nodes'),
    kind('services', 'Services'),
  ];

  it('puts the page a short name names first: `ns` as a keyword came after Sensors and PinpointSlots, as an alias it comes before them (Nodes holds the letters too, and stays last)', () => {
    const asKeywords = rank([{ owner: 'p', candidates: kinds({ keywords: 'Nameset ns' }) }], wordsOf('ns'), 10);
    expect(titles(asKeywords.hits)).toEqual(['Sensors', 'PinpointSlots', 'Namesets', 'Nodes']);
    expect(asKeywords.hits.map((hit) => hit.score)).toEqual([58 * 6, 39 * 6, 76 * 3, 34 * 6]);

    const asAliases = rank([{ owner: 'p', candidates: kinds({ aliases: 'Nameset ns' }) }], wordsOf('ns'), 10);
    expect(titles(asAliases.hits)).toEqual(['Namesets', 'Sensors', 'PinpointSlots', 'Nodes']);
    expect(asAliases.hits.map((hit) => hit.score)).toEqual([100 * 6, 58 * 6, 39 * 6, 34 * 6]);
    expect(asAliases.total).toBe(4);
  });

  it('ranks the start of an alias with the start of a title, and both above the start of a word in the middle of one', () => {
    const list = [candidate('a', 'Open racks'), candidate('b', 'Rackmount'), candidate('c', 'Zebra', { aliases: 'racks' }), candidate('d', 'Zebras rack'), candidate('e', 'Rack', { order: 9 })];
    const { hits } = rank([{ owner: 'p', candidates: list }], wordsOf('rack'), 10);
    // `Rack` is the whole title (600). `Rackmount` and the alias `racks` are prefixes (528) and tie: the place in the list decides. `Open racks` and `Zebras rack` start a word inside the title (456).
    expect(titles(hits)).toEqual(['Rack', 'Rackmount', 'Zebra', 'Open racks', 'Zebras rack']);
    expect(hits.map((hit) => hit.score)).toEqual([600, 528, 528, 456, 456]);
  });

  it('breaks a tie between an exact alias and an exact title as it breaks any tie: the order, then the shorter title, then the title and the key by code unit', () => {
    const list = [candidate('long', 'Namesets', { aliases: 'ns', order: 3 }), candidate('exact', 'ns', { order: 3 }), candidate('first', 'Zebra', { aliases: 'ns', order: 1 })];
    const { hits } = rank([{ owner: 'p', candidates: list }], wordsOf('ns'), 10);
    expect(hits.map((hit) => hit.score)).toEqual([600, 600, 600]);
    expect(ids(hits)).toEqual(['first', 'exact', 'long']);
    expect(ids(rank([{ owner: 'p', candidates: [...list].reverse() }], wordsOf('ns'), 10).hits)).toEqual(['first', 'exact', 'long']);
  });

  it('is exactly what scoring every candidate, sorting by the rule and keeping the first few gives, with aliases among the fields', () => {
    const next = random(23);
    const alphabet = 'abcdeop -_';
    const text = (length: number) => Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)] ?? 'a').join('');
    const list = Array.from({ length: 800 }, (_, index) =>
      candidate(`id${String(index)}`, text(3 + Math.floor(next() * 12)), { context: text(8), aliases: index % 3 === 0 ? text(2 + Math.floor(next() * 4)) : undefined, order: index % 7 }),
    );
    const words = wordsOf('o a');
    const naive = list
      .map((item) => ({ item, score: scoreCandidate(words, item) }))
      .filter((hit): hit is { item: Candidate; score: number } => hit.score !== undefined)
      .sort((a, b) => b.score - a.score || (a.item.order ?? 0) - (b.item.order ?? 0) || a.item.title.length - b.item.title.length || (a.item.title < b.item.title ? -1 : a.item.title > b.item.title ? 1 : 0) || (a.item.id < b.item.id ? -1 : 1));
    expect(naive.length).toBeGreaterThan(100);
    // The aliases decide something: scoring the same list without them gives another order.
    const without = list.map(({ aliases: _aliases, ...rest }) => rest);
    expect(ids(rank([{ owner: 'p', candidates: without }], words, 40).hits)).not.toEqual(naive.slice(0, 40).map((hit) => hit.item.id));
    for (const limit of [1, 5, 40, 799]) {
      const few = rank([{ owner: 'p', candidates: list }], words, limit);
      expect(ids(few.hits)).toEqual(naive.slice(0, limit).map((hit) => hit.item.id));
      expect(few.total).toBe(naive.length);
    }
  });
});

describe('rank, without a query', () => {
  it('is not a ranking: the candidates keep the order they came in, up to the limit, and all are counted', () => {
    const list = [candidate('z', 'zebra'), candidate('a', 'apple'), candidate('m', 'mango')];
    const { hits, total } = rank([{ owner: 'p', candidates: list }], [], 2);
    expect(titles(hits)).toEqual(['zebra', 'apple']);
    expect(total).toBe(3);
    expect(hits.every((hit) => hit.score === 0)).toBe(true);
  });

  it('honours an explicit order, lowest first, and the place in the list after it', () => {
    const list = [candidate('c', 'host command', { order: 1000 }), candidate('a', 'own one'), candidate('b', 'own two')];
    expect(titles(rank([{ owner: 'p', candidates: list }], [], 10).hits)).toEqual(['own one', 'own two', 'host command']);
  });

  it('reads the sources in the order they are given', () => {
    const hits = rank([{ owner: 'one', candidates: [candidate('a', 'a1'), candidate('b', 'a2')] }, { owner: 'two', candidates: [candidate('c', 'b1')] }], [], 10).hits;
    expect(titles(hits)).toEqual(['a1', 'a2', 'b1']);
  });
});
