import { describe, expect, it } from 'vitest';
import { a11yOf, fractionOf, mergeProgress, normProgress, restartProgress, stepProgress } from './progress';
import type { Progress } from './types';

// Progress is what the producer said and never invented (ch05 171: no fake percentages). The mock's `normProgress`, `mergeProgress`, `stepProgress`, `fraction` and `want`
// (shell-notify.js:122-147, 751-770): null, indeterminate, a percent, a count with a unit, or steps; a partial update merges into the record's own; the value a screen reader is told is
// `aria-valuenow` and `aria-valuetext` (S86).

const determinate = (current: number, total: number, unit = ''): Progress => ({ kind: 'determinate', current, total, unit });

describe('normProgress', () => {
  it('has nothing for nothing, and says indeterminate when the work cannot be measured', () => {
    expect(normProgress(null)).toBeNull();
    expect(normProgress(undefined)).toBeNull();
    expect(normProgress('indeterminate')).toEqual({ kind: 'indeterminate' });
    expect(normProgress({ kind: 'indeterminate' })).toEqual({ kind: 'indeterminate' });
  });

  it('reads a bare number as a percent, clamped to 0 to 100', () => {
    expect(normProgress(50)).toEqual(determinate(50, 100, '%'));
    expect(normProgress(150)).toEqual(determinate(100, 100, '%'));
    expect(normProgress(-5)).toEqual(determinate(0, 100, '%'));
    expect(normProgress(12.5)).toEqual(determinate(12.5, 100, '%'));
    expect(normProgress(Number.NaN)).toBeNull();
    expect(normProgress(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('reads a count with its total and unit, clamped to the total', () => {
    expect(normProgress({ current: 3, total: 5, unit: 'items' })).toEqual(determinate(3, 5, 'items'));
    expect(normProgress({ current: 9, total: 5 })).toEqual(determinate(5, 5, ''));
    expect(normProgress({ current: -2, total: 5 })).toEqual(determinate(0, 5, ''));
    expect(normProgress({ kind: 'determinate', current: 1, total: 2 })).toEqual(determinate(1, 2, ''));
  });

  it('refuses a total that is not a positive number: a bar needs the whole it is a part of', () => {
    expect(normProgress({ current: 1, total: 0 })).toBeNull();
    expect(normProgress({ current: 1, total: -3 })).toBeNull();
    expect(normProgress({ current: 1 })).toBeNull();
    expect(normProgress({ total: 5 })).toBeNull();
    expect(normProgress({ current: Number.NaN, total: 5 })).toBeNull();
  });

  it('bounds the unit to sixteen characters and cleans it', () => {
    const unit = normProgress({ current: 1, total: 2, unit: `  ${'u'.repeat(40)}\n` });
    expect(unit).toMatchObject({ kind: 'determinate' });
    expect(unit?.kind === 'determinate' ? unit.unit : '').toHaveLength(16);
  });

  it('reads steps: the step in progress is 1-based and the label is the step\'s own', () => {
    expect(normProgress({ kind: 'steps', current: 2, total: 3, steps: ['Fetch', 'Build', 'Apply'] })).toEqual({ kind: 'steps', current: 2, total: 3, label: 'Build', steps: ['Fetch', 'Build', 'Apply'] });
    expect(normProgress({ kind: 'steps', current: 0, total: 3 })).toEqual({ kind: 'steps', current: 1, total: 3, label: '', steps: undefined });
    expect(normProgress({ kind: 'steps', current: 99, total: 3 })).toEqual({ kind: 'steps', current: 3, total: 3, label: '', steps: undefined });
    expect(normProgress({ steps: ['a', 'b'], current: 1, total: 2 })).toMatchObject({ kind: 'steps' });
    expect(normProgress({ current: 1, total: 4, label: 'Resolve' })).toMatchObject({ kind: 'steps', label: 'Resolve' });
  });

  it('bounds the list to twenty steps, a step to forty characters and a label to sixty', () => {
    const many = Array.from({ length: 30 }, (_, index) => `step ${String(index)} ${'x'.repeat(60)}`);
    const read = normProgress({ kind: 'steps', current: 1, total: 30, steps: many, label: 'l'.repeat(100) });
    expect(read?.kind === 'steps' ? read.steps?.length : 0).toBe(20);
    expect(read?.kind === 'steps' ? read.steps?.every((step) => step.length <= 40) : false).toBe(true);
    expect(read?.kind === 'steps' ? read.label.length : 0).toBe(60);
  });
});

describe('mergeProgress: a partial update goes into the progress the record has', () => {
  it('keeps the total and the unit of a count', () => {
    expect(normProgress(mergeProgress(determinate(0, 40, 'GiB'), { current: 6 }))).toEqual(determinate(6, 40, 'GiB'));
  });

  it('lets a bare number and an object with its own kind replace it', () => {
    expect(normProgress(mergeProgress(determinate(0, 40, 'GiB'), 10))).toEqual(determinate(10, 100, '%'));
    expect(normProgress(mergeProgress(determinate(0, 40, 'GiB'), 'indeterminate'))).toEqual({ kind: 'indeterminate' });
  });

  it('does not merge into indeterminate work: a lone count has no whole', () => {
    expect(normProgress(mergeProgress({ kind: 'indeterminate' }, { current: 3 }))).toBeNull();
    expect(normProgress(mergeProgress(null, { current: 3 }))).toBeNull();
  });

  it('lets the label of a step follow its list when only the number moves', () => {
    const steps: Progress = { kind: 'steps', current: 1, total: 3, label: 'Fetch', steps: ['Fetch', 'Build', 'Apply'] };
    expect(normProgress(mergeProgress(steps, { current: 3 }))).toMatchObject({ current: 3, label: 'Apply' });
  });
});

describe('stepProgress', () => {
  const steps: Progress = { kind: 'steps', current: 1, total: 3, label: 'Fetch', steps: ['Fetch', 'Build', 'Apply'] };

  it('moves to a step by number, and the label follows the list', () => {
    expect(stepProgress(steps, 2)).toMatchObject({ kind: 'steps', current: 2, label: 'Build' });
  });

  it('keeps the number and names the step by a label, when there is no list', () => {
    const plain: Progress = { kind: 'steps', current: 2, total: 5, label: 'Download', steps: undefined };
    expect(stepProgress(plain, 3)).toMatchObject({ current: 3, label: 'Download' });
    expect(stepProgress(plain, 'Verify')).toMatchObject({ current: 2, label: 'Verify' });
  });

  it('takes { current, total, label }, filling in what it leaves out from the steps it has', () => {
    expect(stepProgress(steps, { current: 3, label: 'Wait' })).toMatchObject({ kind: 'steps', current: 3, total: 3, label: 'Wait' });
    expect(stepProgress(null, { current: 1, total: 4, label: 'Resolve' })).toMatchObject({ kind: 'steps', current: 1, total: 4, label: 'Resolve' });
  });

  it('has nothing to say about a step of work that has no steps: a bare number needs its total', () => {
    expect(stepProgress(null, 2)).toBeNull();
    expect(stepProgress(null, 'x')).toBeNull();
    expect(stepProgress(determinate(1, 2), 2)).toBeNull();
  });
});

describe('restartProgress: Retry starts the bar over', () => {
  it('goes back to zero, or to the first step, and leaves indeterminate work alone', () => {
    expect(restartProgress(determinate(30, 40, 'GiB'))).toEqual(determinate(0, 40, 'GiB'));
    expect(restartProgress({ kind: 'steps', current: 3, total: 3, label: 'Apply', steps: ['Fetch', 'Build', 'Apply'] })).toMatchObject({ current: 1, label: 'Fetch' });
    expect(restartProgress({ kind: 'indeterminate' })).toEqual({ kind: 'indeterminate' });
    expect(restartProgress(null)).toBeNull();
  });
});

describe('fractionOf', () => {
  it('is how far it is, from 0 to 1; a step counts the steps behind it; indeterminate work has none', () => {
    expect(fractionOf(determinate(1, 4))).toBe(0.25);
    expect(fractionOf({ kind: 'steps', current: 3, total: 4, label: '', steps: undefined })).toBe(0.5);
    expect(fractionOf({ kind: 'indeterminate' })).toBeNull();
  });
});

describe('a11yOf: what a screen reader is told of the bar (S86)', () => {
  it('says the percent for a percent, the count and the unit for a count', () => {
    expect(a11yOf(determinate(42, 100, '%'), 'running')).toEqual({ now: 42, text: '42%', current: 42, total: 100 });
    expect(a11yOf(determinate(3, 5, 'items'), 'running')).toEqual({ now: 60, text: '3 of 5 items', current: 3, total: 5 });
    expect(a11yOf(determinate(2.5, 5), 'running')).toEqual({ now: 50, text: '2.5 of 5', current: 2.5, total: 5 });
  });

  it('says the step and its name', () => {
    expect(a11yOf({ kind: 'steps', current: 2, total: 9, label: 'Download', steps: undefined }, 'running')).toEqual({ now: 11, text: 'Step 2 of 9: Download', current: 2, total: 9 });
    expect(a11yOf({ kind: 'steps', current: 2, total: 9, label: '', steps: undefined }, 'running').text).toBe('Step 2 of 9');
  });

  it('has no value for work that cannot be measured: a number for it would be false', () => {
    expect(a11yOf({ kind: 'indeterminate' }, 'running')).toEqual({ now: null, text: 'Working…', current: 0, total: 0 });
  });

  it('says when the work is paused or waiting', () => {
    expect(a11yOf(determinate(42, 100, '%'), 'paused').text).toBe('42%, paused');
    expect(a11yOf(determinate(0, 100, '%'), 'queued').text).toBe('0%, queued');
  });
});
