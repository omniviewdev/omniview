import { describe, expect, it } from 'vitest';
import { createPanelStore } from '../core/panel';
import { boot as bootPanel, session as panelSession, tool } from '../core/panel/testing';
import { boot as bootTabs, cloudPage, stackPage } from '../core/tabs/testing';
import { MIGRATIONS, readSession, serialiseSession, SESSION_VERSION } from './document';

// The saved session as a document: what is written, and how a text is read back into one. The tab model and the panel model each own their part (their own version, `migrate` and repairs);
// this document wraps the two with the rail's choice and the Terminal tool's screen reader choice, and has a version of its own, so a change of the wrapper is migrated here and a change of a part is migrated in the part.

describe('what the session writes', () => {
  it('is plain JSON that starts with its version, and holds the tabs, the rail and the panel as their models save them, and the Terminal\'s screen reader choice as the person made it', () => {
    const tabs = bootTabs({ home: false });
    tabs.open(cloudPage('instances'));
    tabs.open(stackPage('services'), { how: 'new' });
    const panel = bootPanel({ hostTools: [tool('logs', 'Logs', 20)], plugins: { cloud: [] } });
    panel.store.resize({ size: 333 });
    panel.store.show({ tool: 'logs' });

    const document = serialiseSession({ tabs: tabs.state(), panel: panel.snapshot(), rail: 'stack', terminalScreenReader: true });
    expect(Object.keys(document)).toEqual(['version', 'tabs', 'rail', 'panel', 'terminalScreenReader']);
    expect(document.version).toBe(SESSION_VERSION);
    expect(document.tabs).toEqual(tabs.store.serialise());
    expect(document.panel).toEqual(panel.store.serialise());
    expect(document.rail).toBe('stack');
    expect(document.terminalScreenReader).toBe(true);
    expect(JSON.parse(JSON.stringify(document))).toEqual(document);
  });

  it('says that no rail entry was chosen with null, and a window with nothing in it still writes a whole document', () => {
    const document = serialiseSession({ tabs: bootTabs({ home: false }).state(), panel: createPanelStore().getSnapshot(), rail: null, terminalScreenReader: false });
    expect(document).toEqual({
      version: SESSION_VERSION,
      tabs: { version: 1, active: null, tabs: [] },
      rail: null,
      panel: { version: 1, open: false, height: null, tool: null, active: {}, sessions: [] },
      terminalScreenReader: false,
    });
  });

  it('carries what a person left, and nothing that means now: no output of a panel session, no state of a page, no flag', () => {
    const tabs = bootTabs({ home: false });
    const id = tabs.open(cloudPage('instances'));
    tabs.store.setPageState(id, { scroll: 40 });
    tabs.store.setUnsaved(id, true);
    const panel = bootPanel({ hostTools: [tool('logs', 'Logs', 20)], plugins: { cloud: [] } });
    panel.store.openSession(panelSession('logs', 'cloud', 'worker'));
    panel.store.setSessionState('s1', { state: 'running' });

    const text = JSON.stringify(serialiseSession({ tabs: tabs.state(), panel: panel.snapshot(), rail: 'cloud', terminalScreenReader: false }));
    for (const word of ['scroll', 'unsaved', 'attention', 'running', 'since', 'cause', 'mounted', 'reveal', 'pageState']) {
      expect(text).not.toContain(word);
    }
  });
});

describe('a text that is read', () => {
  const document = (extra: Record<string, unknown> = {}) => JSON.stringify({ version: SESSION_VERSION, tabs: { version: 1, active: null, tabs: [] }, rail: 'cloud', panel: { version: 1 }, terminalScreenReader: true, ...extra });

  it('is nothing when nothing was saved, and a document when it is one: its parts still as saved, for their own models to read', () => {
    expect(readSession(undefined)).toEqual({ kind: 'none' });
    expect(readSession('null')).toEqual({ kind: 'none' });
    expect(readSession(document())).toEqual({ kind: 'saved', tabs: { version: 1, active: null, tabs: [] }, panel: { version: 1 }, rail: 'cloud', terminalScreenReader: true });
  });

  it('has no rail choice when the saved one is not an id, and parts that are absent are absent', () => {
    expect(readSession(document({ rail: null }))).toMatchObject({ kind: 'saved', rail: undefined });
    expect(readSession(document({ rail: 5 }))).toMatchObject({ kind: 'saved', rail: undefined });
    expect(readSession(document({ rail: '' }))).toMatchObject({ kind: 'saved', rail: undefined });
    expect(readSession(JSON.stringify({ version: SESSION_VERSION }))).toEqual({ kind: 'saved', tabs: undefined, panel: undefined, rail: undefined, terminalScreenReader: false });
  });

  it('has the Terminal\'s screen reader mode off unless the document says it is on: a value that is not true or false is the default, never a reason to refuse the session', () => {
    expect(readSession(document({ terminalScreenReader: true }))).toMatchObject({ kind: 'saved', terminalScreenReader: true });
    expect(readSession(document({ terminalScreenReader: false }))).toMatchObject({ kind: 'saved', terminalScreenReader: false });
    for (const junk of [undefined, null, 'true', 1, {}, []]) {
      expect(readSession(document({ terminalScreenReader: junk })), JSON.stringify(junk) ?? 'absent').toMatchObject({ kind: 'saved', terminalScreenReader: false });
    }
  });

  it('is unusable, and says why, when it is not JSON, not a document, or has no whole-number version', () => {
    for (const text of ['', '{"version":1', 'plain words', '[]', '"a string"', '42', 'true', '{}', '{"version":"1"}', '{"version":1.5}', '{"tabs":[]}']) {
      expect(readSession(text), text).toMatchObject({ kind: 'unusable', reason: 'unreadable' });
    }
  });

  it('is unusable when it was saved by a newer version: it is never half used', () => {
    const result = readSession(document({ version: SESSION_VERSION + 1 }));
    expect(result).toMatchObject({ kind: 'unusable', reason: 'foreign-version' });
    expect(result.kind === 'unusable' && result.detail).toContain(`${String(SESSION_VERSION + 1)}`);
  });

  it('is unusable when a part is there and is not an object: the part is not for the wrapper to guess at', () => {
    expect(readSession(document({ tabs: 'junk' }))).toMatchObject({ kind: 'unusable', reason: 'unreadable' });
    expect(readSession(document({ panel: [] }))).toMatchObject({ kind: 'unusable', reason: 'unreadable' });
  });

  it('is migrated one version at a time from an older one, and not at all when a step is missing or fails', () => {
    // A fake history: version 1 held the rail's choice under `railPlugin`; version 2 calls it `rail`; version 3 wraps the panel's part under `panel.v`.
    const steps = {
      1: (value: Record<string, unknown>) => {
        const { railPlugin, ...rest } = value;
        return { ...rest, version: 2, rail: railPlugin };
      },
      2: (value: Record<string, unknown>) => {
        const { panel } = value;
        return { ...value, version: 3, panel: typeof panel === 'object' && panel !== null && 'v' in panel ? panel.v : panel };
      },
    };
    const old = JSON.stringify({ version: 1, tabs: { version: 1, active: null, tabs: [] }, railPlugin: 'cloud', panel: { v: { version: 1, open: true } } });
    expect(readSession(old, { current: 3, steps })).toEqual({ kind: 'saved', tabs: { version: 1, active: null, tabs: [] }, rail: 'cloud', panel: { version: 1, open: true }, terminalScreenReader: false });

    expect(readSession(old, { current: 3, steps: { 1: steps[1] } })).toMatchObject({ kind: 'unusable', reason: 'foreign-version', detail: expect.stringContaining('no migration from version 2') as string });
    const broken = { 1: () => {
      throw new Error('boom'); 
    }, 2: steps[2] };
    expect(readSession(old, { current: 3, steps: broken })).toMatchObject({ kind: 'unusable', reason: 'unreadable', detail: expect.stringContaining('boom') as string });
    const forgetful = { 1: (value: Record<string, unknown>) => value, 2: steps[2] };
    expect(readSession(old, { current: 3, steps: forgetful })).toMatchObject({ kind: 'unusable', reason: 'unreadable' });
  });

  it('has one migration, from version 1 (the first release) to version 2, which adds the Terminal\'s screen reader choice, off', () => {
    expect(SESSION_VERSION).toBe(2);
    expect(Object.keys(MIGRATIONS)).toEqual(['1']);
    expect(MIGRATIONS[1]?.({ version: 1, tabs: { version: 1 }, rail: 'cloud', panel: { version: 1 } })).toEqual({ version: 2, tabs: { version: 1 }, rail: 'cloud', panel: { version: 1 }, terminalScreenReader: false });
  });

  it('reads a document of version 1, which has no screen reader choice, as a session with it off, and its other parts as they were saved', () => {
    const old = JSON.stringify({ version: 1, tabs: { version: 1, active: null, tabs: [] }, rail: 'cloud', panel: { version: 1, open: true } });
    expect(readSession(old)).toEqual({ kind: 'saved', tabs: { version: 1, active: null, tabs: [] }, panel: { version: 1, open: true }, rail: 'cloud', terminalScreenReader: false });
  });
});
