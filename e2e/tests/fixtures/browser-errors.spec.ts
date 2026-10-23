import { expect, test } from '@playwright/test';
import { BrowserErrors } from './browser-errors';

// Exercise the same serialized JSON array consumed by fixture attachments.
test('browser error artifacts aggregate repeated events without conflating kinds', () => {
  const errors = new BrowserErrors();
  errors.add('pageerror', 'failed', 10);
  errors.add('pageerror', 'failed', 20);
  errors.add('console.error', 'failed', 30);
  expect(JSON.parse(errors.serialize())).toEqual([
    { kind: 'pageerror', message: 'failed', occurrences: 2, firstAt: 10, lastAt: 20, messageTruncated: false },
    { kind: 'console.error', message: 'failed', occurrences: 1, firstAt: 30, lastAt: 30, messageTruncated: false },
  ]);
});

test('browser error artifacts conserve every occurrence after distinct-record overflow', () => {
  const errors = new BrowserErrors();
  for (let index = 0; index < 500; index++) {
    errors.add('pageerror', `failure ${index}`, index);
  }

  for (let index = 0; index < 1000; index++) {
    errors.add('pageerror', `unretained ${index}`, 500 + index);
  }

  // Repeated unretained events must each count, while retained events still aggregate.
  for (let index = 0; index < 200; index++) {
    errors.add('pageerror', 'unretained 0', 1500 + index);
  }

  errors.add('pageerror', 'failure 0', 1700);
  const artifact = JSON.parse(errors.serialize());
  expect(artifact).toHaveLength(501);
  expect(artifact.reduce((total: number, record: { occurrences: number }) => total + record.occurrences, 0)).toBe(1701);
  expect(artifact[0].occurrences).toBe(2);
  expect(artifact[500]).toMatchObject({ kind: 'overflow', occurrences: 1200, firstAt: 500, lastAt: 1699, coverageIncomplete: true });
  expect(artifact.filter((record: { kind: string }) => record.kind === 'overflow')).toHaveLength(1);
});

test('browser error artifacts clip huge messages and aggregate by their clipped value', () => {
  const errors = new BrowserErrors();
  const prefix = 'x'.repeat(2048);
  errors.add('pageerror', prefix, 1);
  errors.add('pageerror', prefix + 'a'.repeat(2_000_000), 2);
  errors.add('pageerror', prefix + 'different suffix', 3);
  const serialized = errors.serialize();
  expect(JSON.parse(serialized)).toEqual([
    { kind: 'pageerror', message: prefix, occurrences: 3, firstAt: 1, lastAt: 3, messageTruncated: true },
  ]);
  expect(Buffer.byteLength(serialized)).toBeLessThan(2500);
});

test('browser error artifact serialization stays bounded across a unique huge-message storm', () => {
  const errors = new BrowserErrors();
  const hugeSuffix = '\\\"\n'.repeat(4096);
  for (let index = 0; index < 2000; index++) {
    errors.add('console.error', `${index}: ${hugeSuffix}`, index);
  }

  const serialized = errors.serialize();
  const artifact = JSON.parse(serialized);
  expect(artifact).toHaveLength(501);
  expect(artifact.slice(0, 500).every((record: { message: string; messageTruncated: boolean }) => record.message.length === 2048 && record.messageTruncated)).toBe(true);
  expect(artifact[500]).toMatchObject({ kind: 'overflow', occurrences: 1500, coverageIncomplete: true });
  expect(artifact.reduce((total: number, record: { occurrences: number }) => total + record.occurrences, 0)).toBe(2000);
  // Even JSON escaping at this boundary cannot recreate an unbounded attachment.
  expect(Buffer.byteLength(serialized)).toBeLessThan(4_000_000);
});
