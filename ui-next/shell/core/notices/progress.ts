import { line } from './text';
import { LIMITS, type A11y, type OperationPatch, type Progress, type ProgressInput, type State } from './types';

// Progress is what the producer said and never invented (ch05 171). The mock's `normProgress`, `mergeProgress`, `stepProgress`, `fraction` and `want` (shell-notify.js), made total: whatever
// a plugin hands over becomes one of the three shapes or nothing. A bare number is a percent; a count needs the whole it is a part of; steps count from one.

type Loose = Exclude<ProgressInput, null | 'indeterminate' | number>;

const isLoose = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** The members of an object that are not `undefined`: spreading an explicit `undefined` over a value would erase it. */
function defined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, member]) => member !== undefined)) as Partial<T>;
}

/** What a producer said, as one of the three shapes; `null` for nothing, and for what cannot be read (no whole, not a number). */
export function normProgress(input: ProgressInput | undefined): Progress | null {
  if (input === null || input === undefined) {
    return null;
  }

  if (input === 'indeterminate') {
    return { kind: 'indeterminate' };
  }

  if (typeof input === 'number') {
    return Number.isFinite(input) ? { kind: 'determinate', current: Number(clamp(input, 0, 100).toFixed(2)), total: 100, unit: '%' } : null;
  }

  if (!isLoose(input)) {
    return null;
  }

  if (input.kind === 'indeterminate') {
    return { kind: 'indeterminate' };
  }

  const total = Number(input.total);
  const current = Number(input.current);
  if (!(total > 0) || !Number.isFinite(total) || !Number.isFinite(current)) {
    return null;
  }

  const steps = input.kind === 'steps' || Array.isArray(input.steps) || (input.kind !== 'determinate' && input.label !== undefined && input.unit === undefined);
  if (steps) {
    const count = Math.max(1, Math.round(total));
    const list = Array.isArray(input.steps) ? input.steps.slice(0, LIMITS.steps).map((step) => line(step, LIMITS.stepLabel)) : undefined;
    const at = clamp(Math.round(current), 1, count);
    return { kind: 'steps', current: at, total: count, label: input.label === undefined ? (list?.[at - 1] ?? '') : line(input.label, 60), steps: list };
  }

  return { kind: 'determinate', current: Number(clamp(current, 0, total).toFixed(3)), total: Number(total.toFixed(3)), unit: line(input.unit ?? '', LIMITS.unit) };
}

/**
 * A partial update ({ current: 3 }) goes into the progress the record has: the total and the unit stay. A bare number, a word and an object with a kind of its own replace it; work that
 * cannot be measured has no whole to merge into. For steps, the label follows the list when only the number moves.
 */
export function mergeProgress(previous: Progress | null, input: ProgressInput): ProgressInput {
  if (!isLoose(input) || 'kind' in input || previous === null || previous.kind === 'indeterminate') {
    return input;
  }

  const merged = { ...previous, ...defined(input) };
  return previous.kind === 'steps' && previous.steps !== undefined && input.label === undefined ? { ...merged, label: undefined } : merged;
}

/** A step of work that has steps: by its number, its label, or `{ current, total, label }`. Work that has no steps has none: a bare step number needs its total. */
export function stepProgress(previous: Progress | null, step: NonNullable<OperationPatch['step']>): Progress | null {
  const base = previous?.kind === 'steps' ? previous : null;
  if (typeof step === 'number') {
    return base === null ? null : normProgress({ ...base, current: step, label: base.steps === undefined ? base.label : undefined });
  }

  if (typeof step === 'string') {
    return base === null ? null : normProgress({ ...base, label: step, steps: undefined });
  }

  const own = defined(step);
  return normProgress({
    kind: 'steps',
    total: base?.total,
    steps: base?.steps,
    label: base !== null && own.label === undefined && own.current === undefined ? base.label : undefined,
    ...own,
  });
}

/** Retry starts the bar over: zero, or the first step. Indeterminate work and no work stay as they are. */
export function restartProgress(progress: Progress | null): Progress | null {
  if (progress === null || progress.kind === 'indeterminate') {
    return progress;
  }

  return progress.kind === 'steps' ? { ...progress, current: 1, label: progress.steps?.[0] ?? '' } : { ...progress, current: 0 };
}

/** How far it is, 0 to 1; a step counts the steps behind it; work that cannot be measured has none. */
export function fractionOf(progress: Progress): number | null {
  if (progress.kind === 'indeterminate') {
    return null;
  }

  return clamp(progress.kind === 'steps' ? (progress.current - 1) / progress.total : progress.current / progress.total, 0, 1);
}

const figure = (value: number): string => String(Math.round(value * 100) / 100);

/** What a screen reader is told of a bar (S86): a value only when the work can be measured ("a numeric value for unknown work is false"), and its words, with the counts they were made from. */
export function a11yOf(progress: Progress, state: State): A11y {
  if (progress.kind === 'indeterminate') {
    return { now: null, text: 'Working…', current: 0, total: 0 };
  }

  const fraction = fractionOf(progress) ?? 0;
  let text: string;
  if (progress.kind === 'steps') {
    text = `Step ${String(progress.current)} of ${String(progress.total)}${progress.label === '' ? '' : `: ${progress.label}`}`;
  } else if (progress.unit === '%') {
    text = `${String(Math.round(fraction * 100))}%`;
  } else {
    text = `${figure(progress.current)} of ${figure(progress.total)}${progress.unit === '' ? '' : ` ${progress.unit}`}`;
  }

  return { now: Math.round(fraction * 100), text: state === 'paused' ? `${text}, paused` : state === 'queued' ? `${text}, queued` : text, current: progress.current, total: progress.total };
}
