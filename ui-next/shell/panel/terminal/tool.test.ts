import { isIconName } from '@omniviewdev/kit';
import { describe, expect, it } from 'vitest';
import { LOGS_TOOL } from '../logs';
import { NEW_TERMINAL, TERMINAL_EMPTY, TERMINAL_GONE, TERMINAL_ICON, TERMINAL_TOOL, TERMINAL_TOOL_ID } from './tool';

// The words, the glyph and the place of the host's Terminal tool (ch16 section H; the mock's `def('terminal', { title: 'Terminal', icon: 'LuSquareTerminal', kind: 'sessions', order: 10 })` and its
// empty state, shell-panel.js `terminalBody`, `panelDefault`).

describe('the Terminal tool', () => {
  it('is the host\'s tool, with the mock\'s label', () => {
    expect(TERMINAL_TOOL).toMatchObject({ id: TERMINAL_TOOL_ID, label: 'Terminal' });
    expect(TERMINAL_TOOL_ID).not.toContain(':');
  });

  it('comes before the Logs tool, as the mock orders its tools (Terminal 10, Logs 20), and so is the tool the panel opens on while nobody chose another', () => {
    expect(TERMINAL_TOOL.order).toBe(10);
    expect(LOGS_TOOL.order).toBe(20);
    expect(TERMINAL_TOOL.order ?? Number.POSITIVE_INFINITY).toBeLessThan(LOGS_TOOL.order ?? 0);
  });

  it('names the mock\'s glyph for the tab, the card and the empty state: the terminal screen, not the chevron it stood in with while the kit had none', () => {
    expect(TERMINAL_TOOL.icon).toBe(TERMINAL_ICON);
    expect(TERMINAL_ICON).toBe('square-terminal');
    expect(isIconName(TERMINAL_ICON)).toBe(true);
  });

  it('says in the mock\'s words that it has no session and what starts one', () => {
    expect(TERMINAL_EMPTY).toEqual({ title: 'No terminals', hint: 'Start a shell in this window. A session stays available when you switch tabs.' });
    expect(NEW_TERMINAL).toBe('New terminal');
  });

  it('says that the output of a terminal of the last run is gone, and how to get a shell again', () => {
    expect(TERMINAL_GONE.title).toBe('The earlier output is gone');
    expect(TERMINAL_GONE.hint).toMatch(/new terminal/i);
  });
});
