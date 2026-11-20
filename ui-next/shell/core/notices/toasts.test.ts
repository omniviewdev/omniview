import { describe, expect, it } from 'vitest';
import { SUMMARY, composeStack, type StackEntry } from './toasts';
import { view } from './testing';
import type { RecordView } from './types';

// The stack (ch16 S79, O6; the mock's `toastEntries`, shell-notify.js:1141-1165, and the audit QA-SF-13): at most three toasts, the summary toast included, newest at the bottom; with
// more than three eligible the two newest and one summary toast on top that stands for the rest, so no record is lost. The summary carries the worst severity it hides.

const entries = (count: number, sticky = false): StackEntry[] => Array.from({ length: count }, (_, index) => ({ id: `n${String(index + 1)}`, sticky }));
const views = (list: readonly RecordView[]) => (id: string): RecordView | undefined => list.find((candidate) => candidate.id === id);
const records = (count: number, extra: (index: number) => Partial<RecordView> = () => ({})): RecordView[] => Array.from({ length: count }, (_, index) => view({ id: `n${String(index + 1)}`, title: `Title ${String(index + 1)}`, ...extra(index) }));

describe('composeStack', () => {
  it('is empty for nothing', () => {
    expect(composeStack([], views([]))).toEqual([]);
  });

  it('shows up to three in arrival order, the newest at the bottom', () => {
    const list = records(3);
    const stack = composeStack(entries(3), views(list));
    expect(stack.map((item) => item.id)).toEqual(['n1', 'n2', 'n3']);
    expect(stack.every((item) => item.summary === undefined)).toBe(true);
  });

  it('shows the two newest and a summary toast on top when there are more than three', () => {
    const list = records(5);
    const stack = composeStack(entries(5), views(list));
    expect(stack.map((item) => item.id)).toEqual([SUMMARY, 'n4', 'n5']);
    expect(stack[0]?.summary).toMatchObject({ count: 3, ids: ['n1', 'n2', 'n3'] });
    expect(stack[0]?.record).toBeUndefined();
  });

  it('never shows more than three in all, the summary included, however many there are', () => {
    const list = records(1000);
    expect(composeStack(entries(1000), views(list))).toHaveLength(3);
  });

  it('says the worst severity it hides, not the best (QA-SF-13)', () => {
    const list = records(5, (index) => ({ severity: index === 1 ? 'error' : index === 2 ? 'warning' : 'info' }));
    expect(composeStack(entries(5), views(list))[0]?.summary?.severity).toBe('error');
    const calm = records(5, (index) => ({ severity: index === 2 ? 'warning' : 'success' }));
    expect(composeStack(entries(5), views(calm))[0]?.summary?.severity).toBe('warning');
    expect(composeStack(entries(5), views(records(5)))[0]?.summary?.severity).toBe('info');
  });

  it('keeps each toast by its own key, so a toast that moves is moved and not made again (S108)', () => {
    const list = records(4);
    const stack = composeStack(entries(4), views(list));
    expect(stack.map((item) => item.key)).toEqual([`notice:toast:${SUMMARY}`, 'notice:toast:n3', 'notice:toast:n4']);
  });

  it('carries whether a toast stays and whether it interrupts', () => {
    const list = records(2, (index) => ({ urgent: index === 1 }));
    const stack = composeStack([{ id: 'n1', sticky: true }, { id: 'n2', sticky: false }], views(list));
    expect(stack.map((item) => [item.sticky, item.urgent])).toEqual([[true, false], [false, true]]);
  });

  it('skips a toast whose record is gone', () => {
    const list = records(2);
    expect(composeStack([{ id: 'n1', sticky: false }, { id: 'gone', sticky: false }, { id: 'n2', sticky: false }], views(list)).map((item) => item.id)).toEqual(['n1', 'n2']);
  });

  it('lets the summary stand for the toasts that are gone from the stack, and only those', () => {
    const list = records(4);
    const stack = composeStack([{ id: 'n1', sticky: false }, { id: 'n2', sticky: false }, { id: 'gone', sticky: false }, { id: 'n3', sticky: false }, { id: 'n4', sticky: false }], views(list));
    expect(stack.map((item) => item.id)).toEqual([SUMMARY, 'n3', 'n4']);
    expect(stack[0]?.summary?.ids).toEqual(['n1', 'n2']);
  });
});
