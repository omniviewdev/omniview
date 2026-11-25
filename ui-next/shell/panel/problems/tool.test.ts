import { isIconName } from '@omniviewdev/kit';
import { describe, expect, it } from 'vitest';
import { OPEN_ICON, PROBLEMS_EMPTY, PROBLEMS_EMPTY_ICON, PROBLEMS_ICON, PROBLEMS_TOOL, PROBLEMS_TOOL_ID } from './tool';

// The words, the glyphs and the place of the host's Problems tool (ch16 S114, S121; the mock's `def('problems', { title: 'Problems', icon: 'LuTriangleAlert', order: 30 })` and its empty state).

describe('the Problems tool', () => {
  it('is the host\'s tool, with the mock\'s label and place: Terminal 10, Logs 20, Problems 30', () => {
    expect(PROBLEMS_TOOL).toMatchObject({ id: PROBLEMS_TOOL_ID, label: 'Problems', order: 30 });
    expect(PROBLEMS_TOOL_ID).toBe('problems');
    expect(PROBLEMS_TOOL_ID).not.toContain(':');
  });

  it('draws a glyph of the kit\'s registry: the mock\'s triangle-alert when the registry has it, else the warning triangle it has', () => {
    expect(PROBLEMS_TOOL.icon).toBe(PROBLEMS_ICON);
    expect(isIconName(PROBLEMS_ICON)).toBe(true);
    expect(PROBLEMS_ICON).toBe(isIconName('triangle-alert') ? 'triangle-alert' : 'status-warning');
  });

  it('draws the empty state and the open button with glyphs of the registry too, each the mock\'s name when the registry has it', () => {
    expect(isIconName(PROBLEMS_EMPTY_ICON)).toBe(true);
    expect(PROBLEMS_EMPTY_ICON).toBe(isIconName('circle-check') ? 'circle-check' : 'status-success');
    expect(isIconName(OPEN_ICON)).toBe(true);
    expect(OPEN_ICON).toBe(isIconName('external-link') ? 'external-link' : 'arrow-right');
  });

  it('says in the mock\'s words that nothing is wrong', () => {
    expect(PROBLEMS_EMPTY).toEqual({ title: 'No problems', hint: 'Plugins and connections are healthy.' });
  });
});
