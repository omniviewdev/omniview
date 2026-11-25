import type * as Kit from '@omniviewdev/kit';
import { isIconName } from '@omniviewdev/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OPEN_ICON, PROBLEMS_EMPTY, PROBLEMS_EMPTY_ICON, PROBLEMS_ICON, PROBLEMS_TOOL, PROBLEMS_TOOL_ID } from './tool';

// The words, the glyphs and the place of the host's Problems tool (ch16 S114, S121; the mock's `def('problems', { title: 'Problems', icon: 'LuTriangleAlert', order: 30 })` and its empty state).

describe('the Problems tool', () => {
  it('is the host\'s tool, with the mock\'s label and place: Terminal 10, Logs 20, Problems 30', () => {
    expect(PROBLEMS_TOOL).toMatchObject({ id: PROBLEMS_TOOL_ID, label: 'Problems', order: 30 });
    expect(PROBLEMS_TOOL_ID).toBe('problems');
    expect(PROBLEMS_TOOL_ID).not.toContain(':');
  });

  it('draws the mock\'s glyphs by name, each of them in the kit\'s registry (the kit has them since G3): triangle-alert on the tab, circle-check when nothing is wrong, external-link on the open button', () => {
    expect(PROBLEMS_TOOL.icon).toBe(PROBLEMS_ICON);
    expect([PROBLEMS_ICON, PROBLEMS_EMPTY_ICON, OPEN_ICON]).toEqual(['triangle-alert', 'circle-check', 'external-link']);
    expect([PROBLEMS_ICON, PROBLEMS_EMPTY_ICON, OPEN_ICON].every((name) => isIconName(name))).toBe(true);
  });

  describe('names its glyphs and decides nothing at import', () => {
    afterEach(() => {
      vi.doUnmock('@omniviewdev/kit');
      vi.resetModules();
    });

    it('keeps the mock\'s names when the registry says it does not know them: a fallback would be a second glyph for the same thing', async () => {
      vi.resetModules();
      vi.doMock('@omniviewdev/kit', async (importOriginal) => ({ ...(await importOriginal<typeof Kit>()), isIconName: () => false }));
      // Loaded again, under the mock, on purpose: what a module decides when it is evaluated cannot be the subject of a static import.
      const tool = await import('./tool');
      expect([tool.PROBLEMS_ICON, tool.PROBLEMS_EMPTY_ICON, tool.OPEN_ICON]).toEqual(['triangle-alert', 'circle-check', 'external-link']);
    });
  });

  it('says in the mock\'s words that nothing is wrong', () => {
    expect(PROBLEMS_EMPTY).toEqual({ title: 'No problems', hint: 'Plugins and connections are healthy.' });
  });
});
