import { isIconName } from '@omniviewdev/kit';
import { describe, expect, it } from 'vitest';
import { LOGS_TOOL } from '../logs';
import { OPERATIONS_EMPTY, OPERATIONS_TOOL, OPERATIONS_TOOL_ID, OPERATIONS_UNAVAILABLE } from './tool';

// The words, the glyph and the place of the host's Operations tool (ch16 S114: a singleton; the mock's `def('operations', { title: 'Operations', icon: 'LuActivity', order: 40 })` and its empty state, shell-panel.js `operationsBody`).

describe('the Operations tool', () => {
  it('is the host\'s tool, with the mock\'s label: a host tool\'s id has no colon (a plugin\'s is <plugin>:<tool>)', () => {
    expect(OPERATIONS_TOOL).toMatchObject({ id: OPERATIONS_TOOL_ID, label: 'Operations' });
    expect(OPERATIONS_TOOL_ID).toBe('operations');
    expect(OPERATIONS_TOOL_ID).not.toContain(':');
  });

  it('is the fourth tool, after Logs, as the mock orders its tools (Terminal 10, Logs 20, Problems 30, Operations 40)', () => {
    expect(OPERATIONS_TOOL.order).toBe(40);
    expect(LOGS_TOOL.order ?? Number.POSITIVE_INFINITY).toBeLessThan(OPERATIONS_TOOL.order ?? 0);
  });

  it('draws the mock\'s glyph, which the kit\'s registry has, on the tab and in the empty state', () => {
    expect(OPERATIONS_TOOL.icon).toBe('activity');
    expect(isIconName(OPERATIONS_TOOL.icon)).toBe(true);
  });

  it('says in the mock\'s words that there is nothing to list and what appears here', () => {
    expect(OPERATIONS_EMPTY).toEqual({ title: 'No operations', hint: 'Operations you start and background work from plugins appear here.' });
  });

  it('says in the host\'s words that the service could not be read: a title, and the detail is the feed\'s sentence', () => {
    expect(OPERATIONS_UNAVAILABLE).toEqual({ title: 'Couldn\'t read operations' });
  });
});
