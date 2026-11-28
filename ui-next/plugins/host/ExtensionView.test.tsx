import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { LinkProvider } from '@omniviewdev/kit';
import type * as RuntimeApi from '@omniviewdev/runtime/api';
import { QueryClient, QueryClientContext, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useContext } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelProvider, useMaybePanel } from '../../shell/panel/context';
import { useMaybeRenaming } from '../../shell/panel/renaming';
import { staticPanel } from '../../shell/panel/testing';
import type * as SharedModule from '../loader/shared';
import { ExtensionAuthority, type ExtensionPolicy, type ExtensionSource } from './extensionAuthority';
import { ExtensionAuthorityContext } from './extensionAuthorityContext';
import { evaluateExtensionFeature } from './extensionFeature';
import { ExtensionMenuNavigationContext } from './extensionMenuNavigation';
import { ExtensionView } from './ExtensionView';
import { loadExtensionBody, EXTENSION_DEADLINE_MS } from './extensionRoleLoader';

// Only the transport is replaced. Admission, grants, projection, linking, React hooks and kit all use production code.
const native = vi.hoisted(() => ({ read: vi.fn(), linkReact: vi.fn() }));
vi.mock('@omniviewdev/runtime/api', async load => {
  const api = await load<typeof RuntimeApi>();
  return { ...api, PluginManager: { ...api.PluginManager, ReadExtensionAsset: native.read } };
});
vi.mock('../loader/shared', async importOriginal => {
  const real = await importOriginal<typeof SharedModule>();
  return { ...real, SHARED_V1: { ...real.SHARED_V1, react: async () => {
    native.linkReact();
    return real.SHARED_V1.react();
  } } };
});

const code = `System.register(['react','react/jsx-runtime','react/compiler-runtime','@omniviewdev/kit'], (function (publish) {
  'use strict'; var useState, jsx, Link;
  return { setters: [function(m){useState=m.useState;},function(m){jsx=m.jsx;},function(){},function(m){Link=m.Link;}],
    execute: function() {
      publish({ panel: Panel, sibling: Sibling });
      function Panel(props) {
        const [count, setCount] = useState(0);
        return jsx('article', {children: [
          jsx('button', {onClick: () => setCount(count + 1), children: 'Count ' + count}, 'count'),
          jsx('p', {children: [Object.keys(props).join(','), JSON.stringify(props.input), Object.getPrototypeOf(props.input) === null, Object.isFrozen(props.input)].join('|')}, 'props'),
          jsx(Link, {to: {page: 'another-page'}, children: 'View link'}, 'link')
        ]});
      }
      function Sibling() { return jsx('p', {children: 'Sibling Body'}); }
    }
  };
}));`;

const names = ['panel', 'sibling'];
const point = 'workspace/sidebar';
const protocol = { kind: 'view', protocol: 'workspace/panel@1', fields: {} } as const;
function pointSource(placement: 'sidebar' | 'detail-tab'): ExtensionSource {
  return {
    id: 'workspace', pin: `sha256:${'a'.repeat(64)}`, generation: 'owner-1', ordinaryReady: true, features: [], views: [],
    manifest: JSON.stringify({ schemaVersion: 1, id: 'workspace', points: [{ ...protocol, id: 'sidebar', label: 'Tools', placement,
      contract: { package: '@test/points', version: '1.0.0', export: 'sidebar' } }], offers: [], bindings: [] }),
  };
}

const peer: ExtensionSource = {
  id: 'peer', pin: `sha256:${'b'.repeat(64)}`, generation: 'peer-1', ordinaryReady: false, features: [], views: names,
  manifest: JSON.stringify({ schemaVersion: 1, id: 'peer', points: [], offers: names.map(id => ({ ...protocol, id, label: 'Panel', requests: [] })),
    bindings: names.map(offer => ({ offer, target: point })) }),
};

function cancellable<T>(promise: Promise<T>): PromiseLike<T> & { readonly cancel: () => Promise<void> } {
  return Object.assign(promise, { cancel: vi.fn(async () => { /* A native reply can race or ignore cancellation. */ }) });
}

async function host(kind: 'sidebar' | 'detail-tab' = 'sidebar') {
  const owner = pointSource(kind);
  const authority = new ExtensionAuthority();
  await authority.replaceSources([owner, peer]);
  const policy: ExtensionPolicy = { known: true, revision: 'one', disabled: false, disabledOffers: [], disabledBindings: [],
    grants: names.map(id => ({ point, offer: `peer/${id}`, ownerPin: owner.pin, contributorPin: peer.pin,
      contract: authority.declaredPoint(point)!.contract, fields: [], continuity: 'issued' })) };
  authority.replacePolicy(policy);
  const placement = authority.setPlacement({}, { owner: owner.id, point, placement: kind, ready: true, visible: true,
    ...(kind === 'detail-tab' ? { scopeKey: 'object-incarnation' } : {}),
    subject: 'private-subject', connection: 'private-connection', visit: {}, context: { private: 'private-owner-field' } })!;
  const binding = (id: string) => authority.point(point).find(row => row.declaration.id === id);
  const back = vi.fn();
  const ownerLinks = { hrefOf: vi.fn(() => '#/workspace/private?connection=private-connection'), onOpen: vi.fn() };
  const frame = (id = 'panel', visit = 1) => <ExtensionAuthorityContext.Provider value={authority}>
    <LinkProvider handler={ownerLinks}>
      <ExtensionView key={visit} surface="sidebar" placement={placement} binding={binding(id)} onBack={back} />
    </LinkProvider>
  </ExtensionAuthorityContext.Provider>;
  return { authority, owner, policy, placement, binding, frame, back, ownerLinks };
}

beforeAll(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('TextEncoder', TextEncoder);
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  native.read.mockReset().mockImplementation(() => cancellable(Promise.resolve(code)));
  native.linkReact.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('selected owner sidebar Body', () => {
  it('starts only with a live binding, reads only the pinned views role, and mounts just the named component with frozen empty input', async () => {
    const h = await host();
    const page = render(h.frame('absent'));
    expect(native.read).not.toHaveBeenCalled();
    expect(native.linkReact).not.toHaveBeenCalled();
    page.rerender(h.frame()); // The cold foreground visit now has its first admitted binding.
    const button = await screen.findByRole('button', { name: 'Count 0' });
    expect(native.read.mock.calls).toEqual([['peer', peer.pin, peer.generation, 'views']]);
    expect(screen.getByText('input|{}|true|true')).toBeVisible();
    expect(screen.queryByText('Sibling Body')).toBeNull();
    fireEvent.click(button);
    expect(button).toHaveTextContent('Count 1');
    const link = screen.getByRole('link', { name: 'View link' });
    expect(link.getAttribute('href')).toBe('#');
    fireEvent.click(link);
    fireEvent(link, new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(h.ownerLinks.hrefOf).not.toHaveBeenCalled();
    expect(h.ownerLinks.onOpen).not.toHaveBeenCalled();
    page.rerender(h.frame('sibling', 2));
    expect(await screen.findByText('Sibling Body')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Count 1' })).toBeNull();
    expect(native.read).toHaveBeenCalledTimes(1);
    expect(native.linkReact).toHaveBeenCalledTimes(1);
  });

  it('does not inherit the owner’s query client, panel, rename controls, authority or menu navigation', async () => {
    const h = await host();
    function ScopeProbe() {
      const capabilities = [useContext(QueryClientContext), useMaybePanel(), useMaybeRenaming(),
        useContext(ExtensionAuthorityContext), useContext(ExtensionMenuNavigationContext)];
      return <p>{capabilities.map(value => value ? 'present' : 'absent').join(',')}</p>;
    }

    // A trusted test export calls a probe with references to private host contexts the real role cannot import.
    vi.stubGlobal('__scopeProbe', ScopeProbe);
    native.read.mockReturnValueOnce(cancellable(Promise.resolve(
      'System.register([],function(ex){return {execute:function(){ex({panel:__scopeProbe,sibling:__scopeProbe});}};});',
    )));
    const menu = { canOpenSidebar: () => false, openSidebar: () => false, canOpenDetail: () => false,
      openDetail: () => false, onDetailReady: () => undefined };
    render(<QueryClientProvider client={new QueryClient()}>
      <PanelProvider panel={staticPanel()}>
        <ExtensionAuthorityContext.Provider value={h.authority}>
          <ExtensionMenuNavigationContext.Provider value={menu}>
            <ScopeProbe />
            {h.frame()}
          </ExtensionMenuNavigationContext.Provider>
        </ExtensionAuthorityContext.Provider>
      </PanelProvider>
    </QueryClientProvider>);
    expect(screen.getByText('present,present,present,present,present')).toBeVisible();
    expect(await screen.findByText('absent,absent,absent,absent,absent')).toBeVisible();
  });

  it('passes a detail Body only its projected input and, only when requested, an unavailable read for an unproven root', async () => {
    const a = new ExtensionAuthority();
    const proto = { kind: 'view', protocol: 'workspace/object@1', fields: { name: 'string', denied: 'number' },
      read: { id: 'workspace/evidence@1', row: { summary: 'string' } } };
    const target = 'workspace/object';
    const owner = { ...pointSource('detail-tab'), manifest: JSON.stringify({ schemaVersion: 1, id: 'workspace', offers: [], bindings: [], points: [{
      ...proto, id: 'object', label: 'Object', placement: 'detail-tab', contract: { package: '@test/points', version: '1.0.0', export: 'object' },
    }] }) };
    const ids = ['plain', 'requesting'];
    const source = { ...peer, views: ids, manifest: JSON.stringify({ schemaVersion: 1, id: peer.id, points: [], offers: ids.map(id => ({
      ...proto, id, label: 'Object information', requests: ['name', 'denied'], ...(id === 'requesting' ? { requestRead: true } : {}),
    })), bindings: ids.map(offer => ({ offer, target })) }) };
    await a.replaceSources([owner, source]);
    const info = a.declaredPoint(target)!;
    a.replacePolicy({ known: true, revision: 'issued', disabled: false, disabledBindings: [], disabledOffers: [], grants: ids.map(id => ({
      point: target, offer: `peer/${id}`, ownerPin: owner.pin, contributorPin: peer.pin, contract: info.contract, fields: ['name'], read: info.read, continuity: 'one',
    })) });
    const holder = {};
    const outlet = { owner: owner.id, point: target, placement: 'detail-tab' as const, visit: {}, visible: true, ready: true,
      scopeKey: 'not-a-root', subject: 'private-subject', connection: 'private-connection', context: { name: 'Allowed', get denied() {
        throw Error('denied');
      } } };
    const placement = a.setPlacement(holder, outlet)!;
    const panel = (index: number) => <ExtensionAuthorityContext.Provider value={a}>
      <ExtensionView key={index} placement={placement} binding={a.eligible(placement)[index]} />
    </ExtensionAuthorityContext.Provider>;
    native.read.mockReturnValueOnce(cancellable(Promise.resolve(`System.register(['react/jsx-runtime'],function(ex){var jsx;return{
      setters:[function(m){jsx=m.jsx;}],execute:function(){ex({plain:Panel,requesting:Panel});function Panel(props){return jsx('p',{children:JSON.stringify(props)});}}
    };});`)));
    const page = render(panel(0));
    expect(await screen.findByText('{"input":{"name":"Allowed"}}')).toBeVisible();
    page.rerender(panel(1));
    expect(await screen.findByText('{"input":{"name":"Allowed"},"related":{"state":"unavailable"}}')).toBeVisible();
    act(() => {
      a.setPlacement(holder, { ...outlet, context: { name: 'Changed' } });
    });
    expect(screen.queryByText(/Allowed/)).toBeNull();
    expect(await screen.findByText('{"input":{"name":"Changed"},"related":{"state":"unavailable"}}')).toBeVisible();
    expect(native.read).toHaveBeenCalledOnce();
    act(() => {
      a.dispose();
    });
    expect(screen.queryByText(/Changed/)).toBeNull();
  });

  it('keeps a committed detail Body, its local state and focus when another surface selects information', async () => {
    const h = await host('detail-tab');
    const menu = { kind: 'menu', protocol: 'terminal-owner/actions@1', fields: {} };
    const target = 'terminal-owner/menu';
    const owner: ExtensionSource = { ...h.owner, id: 'terminal-owner', pin: `sha256:${'c'.repeat(64)}`, manifest: JSON.stringify({ schemaVersion: 1, id: 'terminal-owner',
      points: [{ ...menu, id: 'menu', label: 'Actions', placement: 'context-menu', contract: { package: '@test/menu', version: '1.0.0', export: 'menu' } }],
      offers: [], bindings: [] }) };
    const actor: ExtensionSource = { ...peer, id: 'actor', pin: `sha256:${'d'.repeat(64)}`, features: ['info'], views: [], manifest: JSON.stringify({ schemaVersion: 1, id: 'actor',
      points: [], offers: [{ ...menu, id: 'info', label: 'Information', requests: [], action: { kind: 'info' } }], bindings: [{ offer: 'info', target }] }) };
    await h.authority.replaceSources([h.owner, peer, owner, actor]);
    h.authority.replacePolicy({ ...h.policy, grants: [...h.policy.grants, { point: target, offer: 'actor/info', fields: [], ownerPin: owner.pin,
      contributorPin: actor.pin, contract: h.authority.declaredPoint(target)!.contract, continuity: 'menu' }] });
    render(<ExtensionAuthorityContext.Provider value={h.authority}><ExtensionView placement={h.placement} binding={h.binding('panel')} /></ExtensionAuthorityContext.Provider>);
    const button = await screen.findByRole('button', { name: 'Count 0' });
    fireEvent.click(button);
    button.focus();
    const opening = h.authority.setPlacement({}, { owner: owner.id, point: target, placement: 'context-menu', context: {}, subject: 'session',
      scopeKey: 'other-instance', visit: {}, ready: true, visible: true })!;
    const choice = h.authority.beginDemand(opening, h.authority.eligible(opening)[0])!;
    native.read.mockReturnValueOnce(cancellable(Promise.resolve('System.register([],function(ex){return {execute:function(){ex(\'info\',()=>({text:\'Information\'}));}};});')));
    await expect(evaluateExtensionFeature(h.authority, choice)).resolves.toEqual({ text: 'Information' });
    h.authority.endPlacement(opening);
    expect(screen.getByRole('button', { name: 'Count 1' })).toBe(button);
    expect(button).toHaveFocus();
    act(() => {
      h.authority.endPlacement(h.placement);
    });
    expect(screen.queryByRole('button', { name: 'Count 1' })).toBeNull();
  });

  it('withdraws even before new frame props, restores focus locally, and cannot replay after regrant without Retry or a fresh visit', async () => {
    const h = await host();
    const page = render(h.frame());
    const button = await screen.findByRole('button', { name: 'Count 0' });
    fireEvent.click(button);
    button.focus();
    act(() => {
      h.authority.clearPolicy();
    });
    expect(screen.queryByRole('button', { name: 'Count 1' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Extension view' })).toHaveFocus();
    expect(screen.getByText('View unavailable', { selector: 'strong' })).toBeVisible();
    act(() => {
      h.authority.replacePolicy(h.policy);
    });
    page.rerender(h.frame());
    expect(screen.queryByText('input|{}|true|true')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(h.back).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Count 0' })).toBeVisible();
    // Remove and readmit the *same pin and native generation*. Its old code cannot be reused across a source lifetime gap.
    act(() => {
      h.authority.retireSource('peer');
    });
    await act(async () => h.authority.replaceSources([h.owner, peer]));
    page.rerender(h.frame());
    expect(screen.queryByRole('button', { name: 'Count 0' })).toBeNull();
    page.rerender(h.frame('panel', 2));
    expect(await screen.findByRole('button', { name: 'Count 0' })).toBeVisible();
    expect(native.read).toHaveBeenCalledTimes(2);
    expect(native.linkReact).toHaveBeenCalledTimes(2);
  });

  it.each(['success', 'failure'])('fences a late native %s across revoke, regrant and fresh Retry', async outcome => {
    const started = Promise.withResolvers<void>();
    const late = Promise.withResolvers<string>();
    const request = cancellable(late.promise);
    native.read.mockImplementationOnce(() => {
      started.resolve();
      return request;
    });
    const h = await host();
    const page = render(h.frame());
    await started.promise;
    act(() => {
      h.authority.clearPolicy();
    });
    act(() => {
      h.authority.replacePolicy(h.policy);
    });
    page.rerender(h.frame());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(native.linkReact).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    const button = await screen.findByRole('button', { name: 'Count 0' });
    fireEvent.click(button);
    await act(async () => {
      if (outcome === 'success') {
        late.resolve(code);
      } else {
        late.reject({ get message() {
          throw new Error('must not inspect');
        } });
      }
    });
    expect(request.cancel).toHaveBeenCalledOnce();
    expect(native.linkReact).toHaveBeenCalledOnce();
    expect(button).toHaveTextContent('Count 1');
    expect(screen.queryByText('View unavailable', { selector: 'strong' })).toBeNull();
    expect(native.read).toHaveBeenCalledTimes(2);
  });

  it('announces only a slow foreground demand and replaces its busy region with Retry at the deadline', async () => {
    const h = await host();
    const started = Promise.withResolvers<void>();
    const bytes = Promise.withResolvers<string>();
    native.read.mockImplementationOnce(() => {
      started.resolve();
      return cancellable(bytes.promise);
    });
    vi.useFakeTimers();
    render(h.frame());
    await started.promise;
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();
    expect(screen.getByRole('group', { name: 'View content' })).toHaveAttribute('aria-busy', 'true');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(status).toHaveTextContent('Loading view…');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(status).toHaveTextContent('Still loading view…');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXTENSION_DEADLINE_MS - 1000);
    });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    bytes.resolve(code);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(native.linkReact).not.toHaveBeenCalled();
  });

  it('shares the initial deadline between the native read and a suspended first Body commit', async () => {
    const h = await host();
    const started = Promise.withResolvers<void>();
    const bytes = Promise.withResolvers<string>();
    const suspended = Promise.withResolvers<void>();
    const suspension: unknown = suspended.promise;
    const Body = vi.fn(() => {
      throw suspension;
    });
    vi.stubGlobal('__suspendedBody', Body);
    native.read.mockImplementationOnce(() => {
      started.resolve();
      return cancellable(bytes.promise);
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    render(h.frame());
    await started.promise;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXTENSION_DEADLINE_MS - 1000);
      bytes.resolve('System.register([],function(ex){return {execute:function(){ex({panel:__suspendedBody,sibling:__suspendedBody});}};});');
    });
    expect(Body).toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    await act(async () => {
      suspended.resolve();
    });
    expect(screen.queryByRole('group', { name: 'View content' })).toBeNull();
  });

  it('records a hidden location without reading code; closes hidden Body state and never wakes an already withdrawn visit', async () => {
    let hidden = true;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    const h = await host();
    const page = render(h.frame());
    expect(native.read).not.toHaveBeenCalled();
    const visibility = (next: boolean) => {
      hidden = next;
      document.dispatchEvent(new Event('visibilitychange'));
    };

    act(() => {
      visibility(false);
    });
    const button = await screen.findByRole('button', { name: 'Count 0' });
    fireEvent.click(button);
    act(() => {
      visibility(true);
    });
    expect(screen.queryByText('Count 1')).toBeNull();
    act(() => {
      visibility(false);
    });
    expect(await screen.findByRole('button', { name: 'Count 0' })).toBeVisible();
    act(() => {
      h.authority.clearPolicy();
    });
    act(() => {
      visibility(true);
    });
    act(() => {
      h.authority.replacePolicy(h.policy);
    });
    page.rerender(h.frame());
    act(() => {
      visibility(false);
    });
    expect(screen.getByText('View unavailable', { selector: 'strong' })).toBeVisible();
    expect(screen.queryByText('Count 0')).toBeNull();
  });

  it('contains a peer render fault and retries only on selection, without rendering its private error', async () => {
    native.read.mockReturnValueOnce(cancellable(Promise.resolve(code.replace('const [count, setCount]', 'throw new Error(\'private diagnostics\'); const [count, setCount]'))));
    const h = await host();
    const caught = vi.fn();
    render(h.frame(), { onCaughtError: caught });
    expect(await screen.findByText('View unavailable', { selector: 'strong' })).toBeVisible();
    expect(caught).toHaveBeenCalledOnce();
    expect(screen.queryByText('private diagnostics')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('View unavailable', { selector: 'strong' });
    expect(caught).toHaveBeenCalledTimes(2);
    expect(native.read).toHaveBeenCalledOnce();
  });
});

describe('verified view role linker', () => {
  it('shares an in-flight role across a foreground handoff; retiring the first demand cannot cancel the second', async () => {
    const started = Promise.withResolvers<void>();
    const bytes = Promise.withResolvers<string>();
    const request = cancellable(bytes.promise);
    native.read.mockImplementationOnce(() => {
      started.resolve();
      return request;
    });
    const h = await host();
    const first = h.authority.beginDemand(h.placement, h.binding('panel')!)!;
    const denied = expect(loadExtensionBody(h.authority, first, 'sidebar')).rejects.toThrow('Extension unavailable');
    await started.promise;
    const second = h.authority.beginDemand(h.placement, h.binding('sibling')!)!;
    const loaded = loadExtensionBody(h.authority, second, 'sidebar');
    bytes.resolve(code);
    await denied;
    expect((await loaded).name).toBe('Sibling');
    expect(request.cancel).not.toHaveBeenCalled();
    expect(native.read).toHaveBeenCalledOnce();
    expect(native.linkReact).toHaveBeenCalledOnce();
    expect(h.authority.current(first)).toBe(false);
  });

  it('refuses even a current view demand from the wrong physical outlet; the detail surface can mount that same demand', async () => {
    const h = await host('detail-tab');
    const demand = h.authority.beginDemand(h.placement, h.binding('panel')!)!;
    expect(h.authority.current(demand)).toBe(true);
    await expect(loadExtensionBody(h.authority, demand, 'sidebar')).rejects.toThrow('Extension unavailable');
    expect(native.read).not.toHaveBeenCalled();
    expect((await loadExtensionBody(h.authority, demand, 'detail-tab')).name).toBe('Panel');
  });

  it.each(['react-dom', 'react/jsx-dev-runtime', '@omniviewdev/runtime/ui/v1', '@omniviewdev/runtime/api', './chunk.js', 'https://invalid.example/chunk'])('refuses %s before linking even React', async name => {
    native.read.mockReturnValueOnce(cancellable(Promise.resolve(code.replace('react/compiler-runtime', name))));
    const h = await host();
    const demand = h.authority.beginDemand(h.placement, h.binding('panel')!)!;
    await expect(loadExtensionBody(h.authority, demand, 'sidebar')).rejects.toThrow('Extension unavailable');
    expect(native.linkReact).not.toHaveBeenCalled();
  });

  it.each([
    ['named register', code.replace('System.register([', 'System.register(\'name\', [')],
    ['duplicate dependency', code.replace('react/compiler-runtime', 'react')],
    ['surplus register', code + code], ['no register', 'void 0'],
    ['surplus export', code.replace('sibling: Sibling', 'sibling: Sibling, extra: Sibling')],
    ['missing sibling', code.replace(', sibling: Sibling', '')], ['nonfunction', code.replace('panel: Panel', 'panel: 1')],
  ])('refuses %s locally without choosing a different export', async (_variant, bytes) => {
    native.read.mockReturnValueOnce(cancellable(Promise.resolve(bytes)));
    const h = await host();
    const demand = h.authority.beginDemand(h.placement, h.binding('panel')!)!;
    await expect(loadExtensionBody(h.authority, demand, 'sidebar')).rejects.toThrow('Extension unavailable');
  });

  it('quarantines an expired native read until it settles; neither its old caller nor a Retry can publish its late bytes', async () => {
    const h = await host();
    const started = Promise.withResolvers<void>();
    const bytes = Promise.withResolvers<string>();
    const request = cancellable(bytes.promise);
    native.read.mockImplementationOnce(() => {
      started.resolve();
      return request;
    });
    vi.useFakeTimers();
    const select = async () => loadExtensionBody(h.authority, h.authority.beginDemand(h.placement, h.binding('panel')!)!, 'sidebar');
    const expired = expect(select()).rejects.toThrow('Extension unavailable');
    await started.promise;
    await vi.advanceTimersByTimeAsync(EXTENSION_DEADLINE_MS);
    await expired;
    await expect(select()).rejects.toThrow('Extension unavailable');
    expect(native.read).toHaveBeenCalledOnce();
    expect(request.cancel).toHaveBeenCalledOnce();
    bytes.resolve(code);
    await vi.advanceTimersByTimeAsync(0);
    expect(native.linkReact).not.toHaveBeenCalled();
    expect((await select()).name).toBe('Panel');
    expect(native.read).toHaveBeenCalledTimes(2);
  });
});
