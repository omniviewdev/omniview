import { isIconName } from '@omniviewdev/kit';
import { describe, expect, it, vi } from 'vitest';
import { createPanelStore, HOST } from '../../core/panel';
import { revealPortsTool } from './reveal';
import { OPEN_ICON, PORTS_ICON, PORTS_TOOL, PORTS_TOOL_ID, STOP_ICON } from './tool';

// The Ports tool of the host as the panel registers it, and the one thing the window does to show it: a tool with no sessions, so showing it opens the panel on it and starts nothing.

describe('the Ports tool', () => {
  it('is the host\'s tool called Ports, in the mock\'s place between Logs and Problems, with an id that a plugin\'s tool id cannot be', () => {
    expect(PORTS_TOOL).toEqual({ id: 'ports', label: 'Ports', icon: PORTS_ICON, order: 25 });
    expect(PORTS_TOOL_ID).toBe('ports');
    expect(PORTS_TOOL_ID).not.toContain(':');
  });

  it('draws glyphs that the kit has: the tab, Stop and Open in browser', () => {
    for (const glyph of [PORTS_ICON, STOP_ICON, OPEN_ICON]) {
      expect(isIconName(glyph)).toBe(true);
    }
  });

  it('registers with the panel like the other tools of the host, and is in the strip whatever the plugins are', () => {
    const store = createPanelStore();
    expect(store.registerTool(PORTS_TOOL)).toEqual({ status: 'done' });
    expect(store.selectors.toolIds(store.getSnapshot())).toEqual(['ports']);
    expect(store.registerTool(PORTS_TOOL)).toEqual({ status: 'noop' });
  });
});

describe('revealPortsTool', () => {
  const mount = () => {
    const store = createPanelStore();
    store.registerTool({ id: 'terminal', label: 'Terminal', icon: 'terminal', order: 10 });
    store.registerTool(PORTS_TOOL);
    return store;
  };

  it('opens a hidden panel on the Ports tool, and starts no session', () => {
    const store = mount();
    expect(store.getSnapshot().open).toBe(false);
    revealPortsTool(store);
    expect(store.getSnapshot().open).toBe(true);
    expect(store.selectors.activeTool(store.getSnapshot())).toBe('ports');
    expect(store.getSnapshot().order).toEqual([]);
  });

  it('puts the tool on screen when the panel is open on another one', () => {
    const store = mount();
    store.show({ tool: 'terminal' });
    revealPortsTool(store);
    expect(store.selectors.activeTool(store.getSnapshot())).toBe('ports');
  });

  it('changes nothing, and tells nobody, when the tool is already shown', () => {
    const store = mount();
    revealPortsTool(store);
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getSnapshot();
    revealPortsTool(store);
    expect(store.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('moves no focus: the page that asked for the forward keeps the keyboard where it was', () => {
    const store = mount();
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    revealPortsTool(store);
    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it('opens the panel on the tool it had when the Ports tool is not registered: a tool that is not there is ignored', () => {
    const store = createPanelStore();
    store.registerTool({ id: 'terminal', label: 'Terminal', icon: 'terminal', order: 10 });
    revealPortsTool(store);
    expect(store.selectors.activeTool(store.getSnapshot())).toBe('terminal');
  });

  it('is a tool of the host: nothing a plugin does can take its place', () => {
    const store = mount();
    expect(store.getSnapshot().tools.ports?.owner).toBe(HOST);
  });
});
