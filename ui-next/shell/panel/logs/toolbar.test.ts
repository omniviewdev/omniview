import { isIconName, type LogViewState } from '@omniviewdev/kit';
import { describe, expect, it } from 'vitest';
import { announcementOf, LOG_TOOLS_LABEL, logToolsOf, tipOf, type LogTool } from './toolbar';

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
  it('says how many lines were copied, in the mock\'s words, and whether they were the selected ones', () => {
    expect(announcementOf({ kind: 'copied', lines: 120, selection: false })).toBe('120 lines copied');
    expect(announcementOf({ kind: 'copied', lines: 1, selection: false })).toBe('1 line copied');
    expect(announcementOf({ kind: 'copied', lines: 3, selection: true })).toBe('3 selected lines copied');
    expect(announcementOf({ kind: 'copied', lines: 1, selection: true })).toBe('1 selected line copied');
  });

  it('says a copy that did not happen, and why in a sentence a person can act on', () => {
    expect(announcementOf({ kind: 'copy-failed' })).toBe('Couldn\'t copy. The clipboard isn\'t available here. Select the lines and copy them with the keyboard.');
  });
});
