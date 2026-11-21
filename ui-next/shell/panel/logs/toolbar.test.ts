import { isIconName, type LogViewState } from '@omniviewdev/kit';
import { describe, expect, it } from 'vitest';
import { announcementOf, fitTools, LOG_TOOLS_LABEL, logToolsOf, MORE_LABEL, MORE_MENU_LABEL, menuLabelOf, slotsFor, tipOf, type LogTool } from './toolbar';

// The buttons of the Logs tool's vertical toolbar for the controls the kit's log view has (P1b-4a), as the mock draws them: its order (Follow, Pause log updates, Wrap lines, Display options, Jump to time,
// Clear, Filter, Copy, Export: shell-panel.js 2467-2483), its glyphs, one fixed name for a toggle with its state in `aria-pressed` (S117), and a button that cannot apply says why ('There are no lines yet', 'The
// stream has ended'). Pure: the component draws what this says.

const RUNNING: LogViewState = { following: true, drawn: true, held: true, paused: false, feed: 'streaming' };
const tools = (state: Partial<LogViewState> = {}, timestamps: 'local' | 'utc' = 'local', copied = false): readonly LogTool[] => logToolsOf({ state: { ...RUNNING, ...state }, timestamps, copied });
const tool = (id: LogTool['id'], state: Partial<LogViewState> = {}, timestamps: 'local' | 'utc' = 'local', copied = false): LogTool => {
  const found = tools(state, timestamps, copied).find((one) => one.id === id);
  if (found === undefined) {
    throw new Error(`no tool ${id}`);
  }

  return found;
};

describe('the toolbar of the Logs tool', () => {
  it('is named as the mock names it: the tool and `tools`', () => {
    expect(LOG_TOOLS_LABEL).toBe('Logs tools');
  });

  it('has the buttons the view supports, in the mock\'s order, with the mock\'s names: the timestamps toggle stands where the mock\'s Display options does', () => {
    expect(tools().map((one) => one.label)).toEqual(['Follow', 'Pause log updates', 'Show timestamps in UTC', 'Clear', 'Copy']);
    expect(tools().map((one) => one.id)).toEqual(['follow', 'pause', 'timestamps', 'clear', 'copy']);
  });

  it('draws glyphs of the kit\'s registry, the mock\'s for the ones it has (LuArrowDownToLine, LuPause, LuEraser, LuCopy)', () => {
    expect(tools().map((one) => one.icon)).toEqual(['arrow-down-to-line', 'pause', 'globe', 'eraser', 'copy']);
    for (const one of tools()) {
      expect(isIconName(one.icon), one.icon).toBe(true);
    }
  });

  it('is a toggle with its state in aria-pressed for Follow, Pause and the timestamps, and a plain command for Clear and Copy', () => {
    expect(tools().map((one) => one.pressed)).toEqual([true, false, false, undefined, undefined]);
    expect(tool('follow', { following: false }).pressed).toBe(false);
    expect(tool('pause', { paused: true }).pressed).toBe(true);
    expect(tool('timestamps', {}, 'utc').pressed).toBe(true);
  });

  it('keeps one name for a toggle whatever its state, and one for Copy while it confirms', () => {
    expect(tool('follow', { following: false }).label).toBe(tool('follow').label);
    expect(tool('pause', { paused: true }).label).toBe(tool('pause').label);
    expect(tool('timestamps', {}, 'utc').label).toBe(tool('timestamps').label);
    expect(tool('copy', {}, 'local', true).label).toBe('Copy');
  });

  it('shows the check where the copy glyph is for the moment a copy is confirmed (the mock: LuCheck for 2 s)', () => {
    expect(tool('copy').icon).toBe('copy');
    expect(tool('copy', {}, 'local', true).icon).toBe('check');
  });

  it('is available: Follow and the timestamps always, whatever the stream does', () => {
    for (const state of [{ feed: 'starting' }, { feed: 'ended' }, { feed: 'failed' }, { drawn: false, held: false }] as const) {
      expect(tool('follow', state).disabledReason).toBeUndefined();
      expect(tool('timestamps', state).disabledReason).toBeUndefined();
    }
  });

  it('cannot Pause a stream that is over, and says so in the mock\'s words (an ended one) and as plainly (a failed one)', () => {
    expect(tool('pause').disabledReason).toBeUndefined();
    expect(tool('pause', { feed: 'starting' }).disabledReason).toBeUndefined();
    expect(tool('pause', { feed: 'ended' }).disabledReason).toBe('The stream has ended');
    expect(tool('pause', { feed: 'failed' }).disabledReason).toBe('The stream has failed');
  });

  it('cannot Clear a view that holds no line: the mock\'s words', () => {
    expect(tool('clear').disabledReason).toBeUndefined();
    expect(tool('clear', { held: false, drawn: false }).disabledReason).toBe('There are no lines yet');
  });

  it('cannot Copy what is not drawn: no line yet, or a level filter that hides every one', () => {
    expect(tool('copy').disabledReason).toBeUndefined();
    expect(tool('copy', { held: false, drawn: false }).disabledReason).toBe('There are no lines yet');
    expect(tool('copy', { held: true, drawn: false }).disabledReason).toBe('No lines match the filters');
  });

  it('can Clear what a level filter hides: the lines are held', () => {
    expect(tool('clear', { held: true, drawn: false }).disabledReason).toBeUndefined();
  });
});

describe('the tooltip of a button', () => {
  it('is its name, and no key hint: the mock binds no chord to these commands and its toolbar passes none (shell-regions.js 309-313)', () => {
    expect(tipOf(tool('follow'))).toBe('Follow');
    expect(tipOf(tool('copy'))).toBe('Copy');
  });

  it('is its name and then the reason, a second line, when it cannot apply (the mock: the name, then the reason)', () => {
    expect(tipOf(tool('clear', { held: false, drawn: false }))).toBe('Clear\nThere are no lines yet');
  });
});

describe('what a screen reader is told', () => {
  it('says how many lines were copied, in the mock\'s words', () => {
    expect(announcementOf({ kind: 'copied', lines: 120 })).toBe('120 lines copied');
    expect(announcementOf({ kind: 'copied', lines: 1 })).toBe('1 line copied');
  });

  it('says a copy that did not happen, and why in a sentence a person can act on', () => {
    expect(announcementOf({ kind: 'copy-failed' })).toBe('Couldn\'t copy. The clipboard isn\'t available here. Select the lines and copy them with the keyboard.');
  });
});

// The mock's rule for a column that does not fit (shell-regions.js 298-308): each button takes a 32 px slot and the column keeps 4 px above; a body too short for every button keeps the FIRST ones and puts the rest behind a
// `⋯` More actions button that takes the last slot, so the buttons that hide first are the LAST ones (Export, Copy, Filter, Clear, Jump to time...) and none is clipped.

describe('the slots of the column', () => {
  it('are the body\'s height less the 4 px above, in slots of 32 px: 229 px (1440 x 900) holds 7, 199 px (1280 x 800) 6, the panel\'s least body, 79 px, 2', () => {
    expect([229, 199, 159, 79].map(slotsFor)).toEqual([7, 6, 4, 2]);
  });

  it('are none for a body that is too short for one', () => {
    expect([35, 4, 0].map(slotsFor)).toEqual([0, 0, 0]);
  });
});

describe('the buttons that do not fit', () => {
  const names = (list: readonly LogTool[]) => list.map((one) => one.id);
  const all = tools();

  it('all stay when they fit, and nothing is behind the More button', () => {
    const fit = fitTools(all, 5);
    expect([names(fit.shown), names(fit.rest)]).toEqual([['follow', 'pause', 'timestamps', 'clear', 'copy'], []]);
    expect(names(fitTools(all, 7).shown)).toHaveLength(5);
    expect(names(fitTools(all, Number.POSITIVE_INFINITY).rest)).toEqual([]);
  });

  it('keep the first ones and put the last behind the More button, which takes the last slot: the last hide first', () => {
    expect([names(fitTools(all, 4).shown), names(fitTools(all, 4).rest)]).toEqual([['follow', 'pause', 'timestamps'], ['clear', 'copy']]);
    expect([names(fitTools(all, 2).shown), names(fitTools(all, 2).rest)]).toEqual([['follow'], ['pause', 'timestamps', 'clear', 'copy']]);
  });

  it('put every one behind it when there is room for none', () => {
    expect([names(fitTools(all, 1).shown), names(fitTools(all, 1).rest)]).toEqual([[], ['follow', 'pause', 'timestamps', 'clear', 'copy']]);
    expect(names(fitTools(all, 0).shown)).toEqual([]);
  });
});

describe('the More button and its menu', () => {
  it('are named as the mock names them: `More actions`, and the menu `Logs actions`', () => {
    expect(MORE_LABEL).toBe('More actions');
    expect(MORE_MENU_LABEL).toBe('Logs actions');
  });

  it('say what a press does, not what a toggle is: a menu has no pressed state of its own (the kit\'s menu has no checked item), so the item says the action', () => {
    expect(menuLabelOf(tool('follow'))).toBe('Stop following');
    expect(menuLabelOf(tool('follow', { following: false }))).toBe('Follow');
    expect(menuLabelOf(tool('pause'))).toBe('Pause log updates');
    expect(menuLabelOf(tool('pause', { paused: true }))).toBe('Resume log updates');
    expect(menuLabelOf(tool('timestamps'))).toBe('Show timestamps in UTC');
    expect(menuLabelOf(tool('timestamps', {}, 'utc'))).toBe('Show timestamps in local time');
    expect(menuLabelOf(tool('clear'))).toBe('Clear');
    expect(menuLabelOf(tool('copy'))).toBe('Copy');
  });

  it('says why an item cannot apply, in its text: a menu item has no second line, so the reason follows the name in brackets', () => {
    expect(menuLabelOf({ ...tool('clear'), disabledReason: 'There are no lines yet' })).toBe('Clear (There are no lines yet)');
    expect(menuLabelOf({ ...tool('pause'), disabledReason: 'The stream has ended' })).toBe('Pause log updates (The stream has ended)');
    expect(menuLabelOf({ ...tool('copy'), disabledReason: 'No lines match the filters' })).toBe('Copy (No lines match the filters)');
  });
});
