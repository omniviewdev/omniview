// The measurement behind the planner (ruling R9): never all the content. Measuring every string costs 104 to 291 ms for 60,000 strings in
// WebKit against a budget of 8 ms for the whole plan (plan 3.3 item 5; RT1 4.6), so a column's natural width is read from a sample: the
// first 100 rows, the last 100 and the rows in view, once per change of data or columns.
import { describe, expect, it } from 'vitest';
import { createTextMeasurer, measureSample, sampleIndexes, SAMPLE_HEAD, SAMPLE_TAIL, type SampledColumn, type TextMeasurer } from './sample';

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
