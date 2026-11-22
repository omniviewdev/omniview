import { describe, expect, it } from 'vitest';
import { resolveWindowKind } from './windowKind';

const windows = [
  { name: 'main', kind: 'workspace' },
  { name: 'settings', kind: 'settings' },
  { name: 'w2', kind: 'panel' },
];

describe('resolveWindowKind', () => {
  it('is settings for the window the service lists as kind settings', async () => {
    expect(await resolveWindowKind({ name: async () => 'settings', list: async () => windows })).toBe('settings');
  });

  it('is other for the main window, a panel window, and a name the service does not know (a page served to a browser)', async () => {
    expect(await resolveWindowKind({ name: async () => 'main', list: async () => windows })).toBe('other');
    expect(await resolveWindowKind({ name: async () => 'w2', list: async () => windows })).toBe('other');
    expect(await resolveWindowKind({ name: async () => 'browser-4', list: async () => windows })).toBe('other');
  });

  it('is other when either call fails: a window that cannot be told what it is draws the shell', async () => {
    expect(await resolveWindowKind({ name: async () => Promise.reject(new Error('no')), list: async () => windows })).toBe('other');
    expect(await resolveWindowKind({ name: async () => 'settings', list: async () => Promise.reject(new Error('no')) })).toBe('other');
  });
});
