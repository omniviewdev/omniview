import { isIconName } from '@omniviewdev/kit';
import { describe, expect, it } from 'vitest';
import { LOGS_EMPTY, LOGS_TOOL, LOGS_TOOL_ID } from './tool';

// The words and the glyph of the host's Logs tool (ch16 section H; the mock's `def('logs', { title: 'Logs', icon: 'LuScrollText', order: 20 })` and its empty state).

describe('the Logs tool', () => {
  it('is the host\'s tool, with the mock\'s label and place', () => {
    expect(LOGS_TOOL).toMatchObject({ id: LOGS_TOOL_ID, label: 'Logs', order: 20 });
    expect(LOGS_TOOL_ID).not.toContain(':');
  });

  it('draws a glyph of the kit\'s registry, not the shell\'s generic one: the tab, the card and the empty state read the same name', () => {
    expect(isIconName(LOGS_TOOL.icon)).toBe(true);
    expect(LOGS_TOOL.icon).toBe('scroll-text');
  });

  it('says in the mock\'s words that it has no session and how one arrives, with no button (decision A20)', () => {
    expect(LOGS_EMPTY).toEqual({ title: 'No log sessions', hint: 'Open the logs of a resource to follow them here.' });
  });
});
