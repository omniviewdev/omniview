import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { filterOptions } from './filter';

// The picker's filter is the palette's matcher over the labels of the options (core/palette/match.ts is the oracle: its own tests pin the scores). What is proved here is what the filter adds: the order it hands back (best
// match first, ties in the order the options were given), what it drops, what it leaves alone, and the runs it says to draw.

type Option = { readonly id: string; readonly label: string; readonly detail?: string | undefined };

const named = (...labels: string[]): Option[] => labels.map((label) => ({ id: label.toLowerCase(), label }));
const labelsOf = (options: readonly Option[], query: string): string[] => filterOptions(options, query).map(({ option }) => option.label);

describe('filterOptions', () => {
  it('keeps every option in the order it was given, with nothing to draw, for a query with no word in it', () => {
    const options = named('zeta', 'Alpha', 'mid');
    const everything = options.map((option) => ({ option, ranges: [] }));

    expect(filterOptions(options, '')).toEqual(everything);
    expect(filterOptions(options, '   ')).toEqual(everything);
    expect(filterOptions(options, '\t \n')).toEqual(everything);
  });

  it('returns the options it was given, not copies of them, and leaves the list it was given as it was', () => {
    const options = Object.freeze(named('north', 'south', 'east'));
    const found = filterOptions(options, 'o');

    expect(found.map(({ option }) => option)).toEqual([options[0], options[1]]);
    expect(found[0]?.option).toBe(options[0]);
    expect(found[1]?.option).toBe(options[1]);
    expect(options.map((option) => option.label)).toEqual(['north', 'south', 'east']);
  });

  it('ranks the whole name above the start of a name, the start of a name above the start of a later word, and that above a match inside a word', () => {
    // 100, 88, 76 and 58 of the matcher, in the order the options come in that is neither the ranking nor the alphabet.
    expect(labelsOf(named('preprod', 'eu-prod', 'prod-eu-west', 'staging', 'prod'), 'prod')).toEqual(['prod', 'prod-eu-west', 'eu-prod', 'preprod']);
  });

  it('keeps options that match equally well in the order they were given, which is not the alphabet', () => {
    expect(labelsOf(named('b-one', 'a-one', 'c-one'), 'one')).toEqual(['b-one', 'a-one', 'c-one']);
    expect(labelsOf(named('c-one', 'b-one', 'a-one'), 'one')).toEqual(['c-one', 'b-one', 'a-one']);
  });

  it('needs every word of the query to match, in any order (AND)', () => {
    const options = named('prod-eu-west', 'prod-us-east', 'staging-eu-west');

    expect(labelsOf(options, 'west prod')).toEqual(['prod-eu-west']);
    expect(labelsOf(options, 'prod west')).toEqual(['prod-eu-west']);
    expect(labelsOf(options, 'prod zzz')).toEqual([]);
    expect(labelsOf(options, 'eu west')).toEqual(['prod-eu-west', 'staging-eu-west']);
  });

  it('puts the option that matches every word best first, whatever place it was given in', () => {
    expect(labelsOf(named('staging-eu-west', 'eu-west'), 'eu west')).toEqual(['eu-west', 'staging-eu-west']);
  });

  it('drops the options no word matches, and returns nothing when none does', () => {
    expect(labelsOf(named('north', 'south'), 'zz')).toEqual([]);
    expect(labelsOf(named('north', 'south'), 'sou')).toEqual(['south']);
    expect(labelsOf([], 'a')).toEqual([]);
  });

  it('does not tell capitals from small letters', () => {
    expect(labelsOf(named('North', 'SOUTH'), 'nor')).toEqual(['North']);
    expect(labelsOf(named('North', 'SOUTH'), 'SoUt')).toEqual(['SOUTH']);
  });

  it('matches the first letters of consecutive words, and the letters of one word in order, as the palette does', () => {
    expect(filterOptions(named('EC2 Instances', 'Volumes'), 'ei')).toEqual([{ option: { id: 'ec2 instances', label: 'EC2 Instances' }, ranges: [[0, 1], [4, 5]] }]);
    expect(labelsOf(named('Deployments', 'Volumes'), 'dply')).toEqual(['Deployments']);
    // Letters that wander over several words match nothing.
    expect(labelsOf(named('Deploy Jobs', 'Volumes'), 'dyj')).toEqual([]);
  });

  it('gives the runs of the label that matched, merged and in order, and none for a query that matched no word of it', () => {
    const [prod] = filterOptions(named('prod-eu-west'), 'prod');
    expect(prod?.ranges).toEqual([[0, 4]]);

    const [two] = filterOptions(named('prod-eu-west'), 'west prod');
    expect(two?.ranges).toEqual([[0, 4], [8, 12]]);

    // The words overlap: the runs are one.
    const [overlap] = filterOptions(named('prod-eu-west'), 'pr prod');
    expect(overlap?.ranges).toEqual([[0, 4]]);

    expect(filterOptions(named('prod-eu-west'), 'zz')).toEqual([]);
  });

  it('draws the run in the label at the place it matched, so a view that cuts the label there shows the matched letters', () => {
    const [found] = filterOptions(named('eu-prod-west'), 'prod');
    const [[from, to] = [0, 0]] = found?.ranges ?? [];

    expect(found?.option.label.slice(from, to)).toBe('prod');
  });
});

describe('the secondary text of an option', () => {
  const options: readonly Option[] = [
    { id: 'a', label: 'ops', detail: 'EKS \u00b7 us-east-1' },
    { id: 'b', label: 'data', detail: 'EKS \u00b7 eu-west-1' },
    { id: 'c', label: 'us-lab' },
  ];

  it('counts when a word of the query is not in the name: typing a region finds the connections of that region', () => {
    expect(labelsOf(options, 'eu-west')).toEqual(['data']);
    expect(labelsOf(options, 'ops us-east')).toEqual(['ops']);
  });

  it('ranks a match in the name above a match in the secondary text', () => {
    expect(labelsOf(options, 'us')).toEqual(['us-lab', 'ops']);
  });

  it('draws runs in the name only, never in the secondary text', () => {
    const found = filterOptions(options, 'eu-west');

    expect(found).toHaveLength(1);
    expect(found[0]?.ranges).toEqual([]);
  });
});

// The core is framework-free (the palette's purity test is the model): no React, no DOM, no other tree. The only things it takes from outside its own directory are the palette's matcher and the palette's plain types.
describe('the picker core', () => {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const sources = readdirSync(directory)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => ({ name, text: readFileSync(path.join(directory, name), 'utf8') }));
  const specifiersOf = (text: string): string[] => [...text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'/g)].map((match) => match[1] ?? '');

  it('has the two pure files it is made of', () => {
    expect(sources.map((source) => source.name).sort()).toEqual(['filter.ts', 'place.ts']);
  });

  it('imports only the palette matcher and the palette types', () => {
    for (const { name, text } of sources) {
      const foreign = specifiersOf(text).filter((specifier) => !['../palette/match', '../palette/types'].includes(specifier));
      expect({ name, foreign }).toEqual({ name, foreign: [] });
    }
  });

  it('touches no browser global and no timer', () => {
    for (const { name, text } of sources) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect({ name, found: /(?<![.\w])(?:document|window|navigator|location|localStorage|sessionStorage|requestAnimationFrame|HTMLElement|setTimeout|clearTimeout|setInterval|performance|Date\.now)\b/.exec(code)?.[0] }).toEqual({ name, found: undefined });
    }
  });
});
