import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ShellRegistration } from '../registration';
import { StaticShell } from '../testing';
import { staticPanel, type StaticSession } from './testing';

// The face of a session tab. jsdom lays nothing out, so what is asserted here is what the markup and the stylesheet carry: the tail of a name (a twin's ordinal) is an element of its own that never
// shrinks, the head is the part that gives way, and no rule gives the head a width its text does not have. The measured layout is the panel probe's (ui-next/shell/probes/panel-probe.mjs).

const registration: ShellRegistration = { plugin: { name: 'Acme' } };
const sheet = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'Header.module.css'), 'utf8');

/** The declarations of the rule whose selector is exactly `selector`, as property to value. */
function rule(selector: string): Readonly<Record<string, string>> {
  const escaped = selector.replaceAll('.', '\\.');
  const found = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(sheet);
  if (found?.[1] === undefined) {
    throw new Error(`Header.module.css has no rule for ${selector}`);
  }

  const declarations: Record<string, string> = {};
  for (const line of found[1].split(';')) {
    const colon = line.indexOf(':');
    if (colon > 0) {
      declarations[line.slice(0, colon).replace(/\/\*.*?\*\//gs, '').trim()] = line.slice(colon + 1).trim();
    }
  }

  return declarations;
}

const session = (title: string, extra: Partial<StaticSession> = {}): StaticSession => ({ tool: 'terminal', title, state: 'running', ...extra });

function mount(sessions: readonly StaticSession[]) {
  const panel = staticPanel({ tools: [{ id: 'terminal', label: 'Terminal', icon: 'terminal', order: 10 }], open: true, sessions });
  return render(<StaticShell registration={registration} panel={panel} />);
}

const part = (root: ParentNode, name: string): HTMLElement | null => root.querySelector<HTMLElement>(`[data-shell-part="${name}"]`);

afterEach(cleanup);

describe('the name of a session tab: the head gives way, the tail stays whole', () => {
  it('draws the ordinal of a twin in an element of its own, after the head, in the title that holds both', () => {
    mount([session('zsh'), session('zsh')]);
    const [, twin] = [...document.querySelectorAll<HTMLElement>('[data-shell-part="sessionTab"]')];
    const head = part(twin, 'sessionHead');
    const tail = part(twin, 'sessionTail');
    expect(head?.textContent).toBe('zsh');
    expect(tail?.textContent).toBe(' (2)');
    expect(head?.parentElement).toBe(tail?.parentElement);
    expect(head?.nextElementSibling).toBe(tail);
  });

  it('draws no tail on a name that has none', () => {
    mount([session('zsh')]);
    expect(part(document, 'sessionTail')).toBeNull();
  });

  it('keeps a long name apart from its generated suffix and its ordinal: the head is the part that is cut', () => {
    mount([session('build-runner-7d8c6f49b-f8q4m'), session('build-runner-7d8c6f49b-f8q4m')]);
    const [, twin] = [...document.querySelectorAll<HTMLElement>('[data-shell-part="sessionTab"]')];
    expect(part(twin, 'sessionHead')?.textContent).toBe('build-runner-7d8c6f49b');
    expect(part(twin, 'sessionTail')?.textContent).toBe('-f8q4m (2)');
  });

  it('never shrinks the tail, and gives way with an ellipsis in the head', () => {
    expect(rule('.sessionTail')).toMatchObject({ flex: '0 0 auto' });
    expect(rule('.sessionHead')).toMatchObject({ overflow: 'hidden', 'text-overflow': 'ellipsis' });
    expect(rule('.sessionHead').flex).toBe('0 1 auto');
  });

  it('gives the head no width its text does not have: a floor in the width of characters made a short head wider than its text, which the tab did not count, so the tab cut the end of the tail', () => {
    const floor = rule('.sessionHead')['min-inline-size'];
    expect(floor === undefined || floor === '0' || floor === '0px').toBe(true);
    expect(rule('.sessionTitle')).toMatchObject({ 'min-inline-size': '0', overflow: 'hidden' });
  });
});

describe('the close control of a session tab', () => {
  it('keeps its slot laid out whether it is shown or not, as the mock does, so a tab never moves when the control appears; the pointer reveals it', () => {
    expect(rule('.sessionClose')).toMatchObject({ flex: '0 0 24px', opacity: '0' });
    expect(sheet).toMatch(/\.sessionItem:is\(\[data-selected\], :hover, :focus-within\) > \.sessionClose\s*\{\s*opacity: 1;/);
  });
});

describe('the `+` of the real header', () => {
  it('draws the arrow of the choice the tool offers, beside the `+` (the header passes the tool\'s menu on)', () => {
    const items = [{ kind: 'action' as const, id: 'bash', label: 'bash', onSelect: () => undefined }];
    const panel = staticPanel({
      tools: [{ id: 'terminal', label: 'Terminal', icon: 'terminal', order: 10 }],
      open: true,
      start: { terminal: { label: 'New terminal', open: () => ({ title: 'zsh', state: 'running' }), menu: { label: 'Choose a shell', subscribe: () => () => undefined, getSnapshot: () => items } } },
    });
    render(<StaticShell registration={registration} panel={panel} />);
    expect(document.querySelector('[data-shell-part="sessionAddChoice"]')?.getAttribute('aria-haspopup')).toBe('menu');
  });
});
