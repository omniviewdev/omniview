// The measurement behind the planner (ruling R9): never all the content. Measuring every string costs 104 to 291 ms for 60,000 strings in
// WebKit against a budget of 8 ms for the whole plan (plan 3.3 item 5; RT1 4.6), so a column's natural width is read from a sample: the
// first 100 rows, the last 100, the rows in view and the rows that hold the longest strings of each column, once per change of data or
// columns. The longest strings are there because a rare long value (a path, an image reference, a selector) sits in neither end of the
// table: without them the long-tailed set of the table bench was fitted 27 to 37 px short on three of seven text columns (B5).
import { describe, expect, it } from 'vitest';
import { createTextMeasurer, longestIndexes, measureSample, sampleIndexes, SAMPLE_HEAD, SAMPLE_LONGEST, SAMPLE_TAIL, type SampledColumn, type TextMeasurer } from './sample';

describe('which rows are measured', () => {
  it('is nothing for no rows', () => {
    expect(sampleIndexes(0)).toEqual([]);
  });

  it('is every row when the table is small', () => {
    expect(sampleIndexes(150)).toEqual(Array.from({ length: 150 }, (_, index) => index));
  });

  it('is the first 100 and the last 100 for a large table, each once, in order', () => {
    const indexes = sampleIndexes(5000);
    expect(indexes).toHaveLength(SAMPLE_HEAD + SAMPLE_TAIL);
    expect(indexes.slice(0, 3)).toEqual([0, 1, 2]);
    expect(indexes.at(-1)).toBe(4999);
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b));
    expect(new Set(indexes).size).toBe(indexes.length);
  });

  it('adds the rows in view', () => {
    const indexes = sampleIndexes(5000, { first: 2000, last: 2030 });
    expect(indexes).toHaveLength(SAMPLE_HEAD + SAMPLE_TAIL + 31);
    expect(indexes).toContain(2000);
    expect(indexes).toContain(2030);
  });

  it('clamps a window that reaches outside the rows and does not repeat a row it shares with the head', () => {
    const indexes = sampleIndexes(5000, { first: -5, last: 120 });
    expect(Math.min(...indexes)).toBe(0);
    expect(new Set(indexes).size).toBe(indexes.length);
    expect(indexes).toHaveLength(SAMPLE_TAIL + 121);
    expect(sampleIndexes(40, { first: 30, last: 90 })).toHaveLength(40);
  });
});

// A fake face: 7 px a character at 13 px, 6 px at 12 px, 8 px for the mono face.
const fakeWidths: Record<string, number> = { text: 7, small: 6, mono: 8 };
function counting() {
  const calls: Array<{ text: string; font: string }> = [];
  const measure: TextMeasurer = (text, font) => {
    calls.push({ text, font });
    return text.length * (fakeWidths[font] ?? 7);
  };

  return { measure, calls };
}

type Row = { name: string; group: string };
const columns: Array<SampledColumn<Row>> = [
  { id: 'name', text: (row) => [{ text: row.name }, { text: row.group, font: 'small' }], tail: () => 6 },
  { id: 'group', text: (row) => row.group },
];

describe('measuring a sample', () => {
  const rows: Row[] = Array.from({ length: 60_000 }, (_, index) => ({ name: `workload-${index}-x7q2z`, group: `group-${index % 40}` }));

  it('reads the widest text of each column, a run in its own face, and the widest kept end', () => {
    const { measure } = counting();
    const sample = measureSample(rows, sampleIndexes(rows.length), columns, measure);
    // The widest name in the sample is `workload-59999-x7q2z` (20 chars, 7 px each); the second line is 6 px a character.
    expect(sample.get('name')?.textWidth).toBe(Math.max(20 * 7, 'group-39'.length * 6));
    expect(sample.get('name')?.tailWidth).toBe(6 * 7);
    expect(sample.get('group')?.textWidth).toBe('group-39'.length * 7);
  });

  it('never measures all the content: a few hundred strings for 60,000 rows', () => {
    const { measure, calls } = counting();
    measureSample(rows, sampleIndexes(rows.length, { first: 30_000, last: 30_030 }), columns, measure);
    // 231 rows; the name column holds two runs and a kept end, the group column one run; repeated strings are measured once.
    expect(calls.length).toBeLessThan(231 * 4);
    expect(calls.length).toBeLessThan(rows.length / 50);
  });

  it('measures the same string once', () => {
    const { measure, calls } = counting();
    const same: Row[] = Array.from({ length: 500 }, () => ({ name: 'api', group: 'core' }));
    measureSample(same, sampleIndexes(same.length), [{ id: 'name', text: (row) => row.name }], measure);
    expect(calls).toHaveLength(1);
  });

  it('gives a column with no text nothing to measure', () => {
    const { measure, calls } = counting();
    const sample = measureSample(rows, [0, 1, 2], [{ id: 'age', text: () => '' }], measure);
    expect(calls).toHaveLength(0);
    expect(sample.get('age')).toEqual({ textWidth: 0, tailWidth: 0 });
  });
});

describe('the rows that hold the longest strings', () => {
  // Seven thousand short names, with a handful of long ones in the middle: the shape of a table whose values are mostly short and
  // sometimes a path.
  const long = new Map<number, string>([[3100, 'x'.repeat(90)], [3200, 'y'.repeat(80)], [4400, 'z'.repeat(70)]]);
  const rows: Row[] = Array.from({ length: 7000 }, (_, index) => ({ name: long.get(index) ?? `job-${index % 50}`, group: `g-${index % 7}` }));
  const flat: Array<SampledColumn<Row>> = [{ id: 'name', text: (row) => row.name }];

  it('finds a rare long value that is in neither end of the table, which the head, the tail and the window miss', () => {
    const { measure } = counting();
    const missed = measureSample(rows, sampleIndexes(rows.length, { first: 10, last: 40 }), flat, measure);
    expect(missed.get('name')?.textWidth).toBeLessThan(90 * 7);
    const found = measureSample(rows, sampleIndexes(rows.length, { first: 10, last: 40 }), flat, measure, longestIndexes(rows, flat));
    expect(found.get('name')?.textWidth).toBe(90 * 7);
  });

  it('lists, for each column, the rows of its longest strings, longest first, and no more than the bound', () => {
    const found = longestIndexes(rows, flat);
    expect(found.get('name')?.slice(0, 3)).toEqual([3100, 3200, 4400]);
    expect(found.get('name')?.length).toBeLessThanOrEqual(SAMPLE_LONGEST);
    expect(SAMPLE_LONGEST).toBe(16);
    expect(longestIndexes(rows, flat, 2).get('name')).toEqual([3100, 3200]);
  });

  it('keeps distinct strings: a longest value that occurs in many rows takes one place, so the next longest is not pushed out', () => {
    const copies: Row[] = Array.from({ length: 1000 }, (_, index) => ({ name: index % 2 === 0 ? 'p'.repeat(60) : index === 501 ? 'q'.repeat(59) : 'r', group: '' }));
    const found = longestIndexes(copies, flat, 4).get('name') ?? [];
    // 500 rows hold the longest string, one holds the second longest: both are in the list.
    expect(found).toContain(501);
    expect(found.filter((index) => index % 2 === 0)).toHaveLength(1);
  });

  it('ranks every run of a cell on its own, so a long second line is found though the first lines are short', () => {
    const stacked: Array<SampledColumn<Row>> = [{ id: 'name', text: (row) => [{ text: row.name }, { text: row.group, font: 'small' }] }];
    const two: Row[] = Array.from({ length: 3000 }, (_, index) => ({ name: `n-${index % 10}`, group: index === 2222 ? 'g'.repeat(50) : `g-${index % 7}` }));
    expect(longestIndexes(two, stacked, 3).get('name')).toContain(2222);
  });

  it('adds the rows whose kept end is the longest, for a column that cuts its names in the middle', () => {
    const kept: Array<SampledColumn<Row>> = [{ id: 'name', text: (row) => row.name, tail: (row) => (row.name.length === 70 ? 12 : 6) }];
    const found = longestIndexes(rows, kept, 2).get('name') ?? [];
    expect(found).toContain(4400);
  });

  it('has nothing for a column with no text, and nothing for no rows', () => {
    expect(longestIndexes(rows, [{ id: 'age', text: () => '' }]).get('age')).toEqual([]);
    expect(longestIndexes([], flat).get('name')).toEqual([]);
  });

  it('measures a bounded number of strings however many rows there are, and each distinct string once', () => {
    const { measure, calls } = counting();
    const unique: Row[] = Array.from({ length: 20_000 }, (_, index) => ({ name: `name-${String(index).padStart(6, '0')}${'x'.repeat(index % 40)}`, group: '' }));
    measureSample(unique, sampleIndexes(unique.length, { first: 9000, last: 9030 }), flat, measure, longestIndexes(unique, flat));
    expect(calls.length).toBeLessThanOrEqual(SAMPLE_HEAD + SAMPLE_TAIL + 31 + SAMPLE_LONGEST);
  });

  it('reads the text of each row once and calls no measurer, so the pass over the rows is cheap', () => {
    let reads = 0;
    const counted: Array<SampledColumn<Row>> = [{ id: 'name', text: (row) => {
      reads += 1; return row.name; 
    } }];
    longestIndexes(rows, counted);
    expect(reads).toBe(rows.length);
  });
});

describe('the canvas measurer', () => {
  function fakeContext() {
    const fonts: string[] = [];
    const measured: string[] = [];
    let font = '';
    const context = {
      get font() {
        return font;
      },
      set font(value: string) {
        font = value;
        fonts.push(value);
      },
      measureText(text: string) {
        measured.push(`${font}|${text}`);
        return { width: text.length * 7.4 };
      },
    };
    return { context, fonts, measured };
  }

  it('measures with the face of each run and rounds up to whole pixels', () => {
    const { context } = fakeContext();
    const measure = createTextMeasurer({ text: '13px a', small: '12px a', mono: '13px m' }, context);
    expect(measure('abcde', 'text')).toBe(Math.ceil(5 * 7.4));
    expect(measure('abcde', 'mono')).toBe(Math.ceil(5 * 7.4));
  });

  it('remembers what it measured', () => {
    const { context, measured } = fakeContext();
    const measure = createTextMeasurer({ text: '13px a', small: '12px a', mono: '13px m' }, context);
    measure('running', 'text');
    measure('running', 'text');
    measure('running', 'small');
    expect(measured).toEqual(['13px a|running', '12px a|running']);
  });
});
