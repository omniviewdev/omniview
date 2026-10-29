// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection } from '../bindings/github.com/omniviewdev/plugin-sdk/pkg/types/models';
import { PluginContext, type PluginContextType } from '../context/plugins/PluginContext';
import type { ConnectionReadiness } from '../hooks/connection/useConnectionReadiness';
import { ConnectionBoundary, ConnectionBoundaryFallback } from './ConnectionBoundary';

const mocks = vi.hoisted(() => ({ readiness: vi.fn() }));
vi.mock('../hooks/connection/useConnectionReadiness', () => ({ useConnectionReadiness: mocks.readiness }));

let state: ConnectionReadiness;
beforeEach(() => {
  state = { phase: 'checking', connect: vi.fn().mockResolvedValue(undefined), retry: vi.fn().mockResolvedValue(undefined) };
  mocks.readiness.mockReset().mockImplementation(() => state);
});
afterEach(cleanup);

const blocked: ConnectionReadiness['phase'][] = ['checking', 'disconnected', 'connecting', 'unauthorized', 'forbidden', 'not-found', 'error'];

describe('ConnectionBoundary', () => {
  it.each(blocked)('never mounts resource content while %s', (phase) => {
    state = { ...state, phase };
    const mounted = vi.fn();
    function Resource() {
      mounted();
      return <div>Resource content</div>;
    }
    render(<ConnectionBoundary pluginID="kubernetes" connectionID="cluster"><Resource /></ConnectionBoundary>);
    expect(mounted).not.toHaveBeenCalled();
    expect(screen.queryByText('Resource content')).toBeNull();
  });

  it('shows the full connection ID while checking, then prefers its readable name', () => {
    const connectionID = 'arn:aws:eks:us-east-1:123456789012:cluster/team/prod%2Fblue';
    const content = () => <ConnectionBoundary pluginID="kubernetes" connectionID={connectionID}><div>Resource content</div></ConnectionBoundary>;
    const { rerender } = render(content());
    expect(screen.getByText(connectionID)).toBeTruthy();
    state = { ...state, connection: new Connection({ name: 'Production' }) };
    rerender(content());
    expect(screen.getByText('Production')).toBeTruthy();
    expect(screen.queryByText(connectionID)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Checking connection' })).toBeTruthy();
  });

  it('mounts only when connected and unmounts immediately after disconnect', () => {
    const mounted = vi.fn();
    const unmounted = vi.fn();
    function Resource() {
      useEffect(() => { mounted(); return unmounted; }, []);
      return <div>Resource content</div>;
    }
    const content = () => <ConnectionBoundary pluginID="kubernetes" connectionID="cluster"><Resource /></ConnectionBoundary>;
    const { rerender } = render(content());
    expect(mounted).not.toHaveBeenCalled();
    state = { ...state, phase: 'connected' };
    rerender(content());
    expect(screen.getByText('Resource content')).toBeTruthy();
    expect(mounted).toHaveBeenCalledTimes(1);
    state = { ...state, phase: 'disconnected' };
    rerender(content());
    expect(screen.queryByText('Resource content')).toBeNull();
    expect(unmounted).toHaveBeenCalledTimes(1);
    expect(state.connect).not.toHaveBeenCalled();
  });

  it('runs readiness with a custom fallback and lets connected content replace it', () => {
    const fallback = vi.fn((value: ConnectionReadiness) => <div>Custom {value.phase}</div>);
    const content = () => <ConnectionBoundary pluginID="kubernetes" connectionID="cluster" fallback={fallback}><div>Resource content</div></ConnectionBoundary>;
    const { rerender } = render(content());
    expect(mocks.readiness).toHaveBeenCalledWith({ pluginID: 'kubernetes', connectionID: 'cluster' });
    expect(screen.getByText('Custom checking')).toBeTruthy();
    state = { ...state, phase: 'connected' };
    rerender(content());
    expect(screen.queryByText('Custom checking')).toBeNull();
    expect(screen.getByText('Resource content')).toBeTruthy();
  });
  it('removes connection identity and recovery status when recovery mounts protected content', () => {
    state = { ...state, phase: 'disconnected' };
    const mounted = vi.fn();
    function Resource() {
      useEffect(() => { mounted(); }, []);
      return <div>Protected resource</div>;
    }
    const fallback = (value: ConnectionReadiness) => (
      <ConnectionBoundaryFallback state={value} connectionDetails={<div>Production cluster identity</div>} />
    );
    const content = () => <ConnectionBoundary pluginID="kubernetes" connectionID="cluster" fallback={fallback}><Resource /></ConnectionBoundary>;
    const { rerender } = render(content());
    expect(screen.getByText('Production cluster identity')).toBeTruthy();
    expect(mounted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Connect and continue' }));
    expect(state.connect).toHaveBeenCalledTimes(1);
    state = { ...state, phase: 'connecting' };
    rerender(content());
    expect(screen.getByText('Production cluster identity')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Connecting' })).toBeTruthy();
    expect(mounted).not.toHaveBeenCalled();
    state = { ...state, phase: 'connected' };
    rerender(content());
    expect(screen.queryByText('Production cluster identity')).toBeNull();
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByText('Connection is ready')).toBeNull();
    expect(screen.getByText('Protected resource')).toBeTruthy();
    expect(mounted).toHaveBeenCalledTimes(1);
  });


  it('keys content by plugin and full opaque connection identity', () => {
    state = { ...state, phase: 'connected' };
    const mounted = vi.fn();
    const unmounted = vi.fn();
    function Resource() {
      useEffect(() => { mounted(); return unmounted; }, []);
      return <div>Resource content</div>;
    }
    const id = 'arn:aws:eks:us-east-1:123456789012:cluster/team/prod%2Fblue';
    const context = (pluginId: string): PluginContextType => ({ pluginId, meta: {} as PluginContextType['meta'], settings: {} });
    const content = (pluginId: string, connectionID: string) => (
      <PluginContext.Provider value={context(pluginId)}>
        <ConnectionBoundary connectionID={connectionID}><Resource /></ConnectionBoundary>
      </PluginContext.Provider>
    );
    const { rerender } = render(content('kubernetes', id));
    expect(mocks.readiness).toHaveBeenLastCalledWith({ pluginID: 'kubernetes', connectionID: id });
    rerender(content('kubernetes-dev', id));
    expect(mounted).toHaveBeenCalledTimes(2);
    expect(unmounted).toHaveBeenCalledTimes(1);
    rerender(content('kubernetes-dev', `${id}/other`));
    expect(mounted).toHaveBeenCalledTimes(3);
    expect(unmounted).toHaveBeenCalledTimes(2);
  });

});

describe('ConnectionBoundaryFallback', () => {
  it.each(blocked)('shows plugin identity above status without a duplicate name while %s', (phase) => {
    state = { ...state, phase, connection: new Connection({ name: 'Saved connection name' }) };
    render(
      <ConnectionBoundaryFallback
        state={state}
        connectionName="Generic connection name"
        connectionDetails={<div>Production cluster identity</div>}
      />,
    );
    const identity = screen.getByText('Production cluster identity');
    const status = screen.getByRole('heading');
    expect(identity.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('Generic connection name')).toBeNull();
    expect(screen.queryByText('Saved connection name')).toBeNull();
  });

  it('renders nothing when connected and keeps hooks stable across phase changes', () => {
    const content = () => (
      <ConnectionBoundaryFallback
        state={state}
        connectionName="Production"
        connectionDetails={<div>Production cluster identity</div>}
      />
    );
    const { container, rerender } = render(content());
    expect(screen.getByText('Production cluster identity')).toBeTruthy();
    state = { ...state, phase: 'connected', message: 'Connection ready' };
    rerender(content());
    expect(container.childElementCount).toBe(0);
    state = { ...state, phase: 'disconnected', message: undefined };
    rerender(content());
    expect(screen.getByText('Production cluster identity')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Connection is disconnected' })).toBeTruthy();
  });

  it('exposes explicit connect, retry, edit, and back actions without automatic requests', () => {
    state = { ...state, phase: 'disconnected' };
    const edit = vi.fn();
    const back = vi.fn();
    render(<ConnectionBoundaryFallback state={state} connectionName="Production" onEditConnection={edit} onBack={back} />);
    expect(state.connect).not.toHaveBeenCalled();
    expect(state.retry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Connect and continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry check' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit connection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to connections' }));
    expect(state.connect).toHaveBeenCalledTimes(1);
    expect(state.retry).toHaveBeenCalledTimes(1);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it.each(['checking', 'connecting'] as const)('announces %s without starting another connection', (phase) => {
    state = { ...state, phase };
    render(<ConnectionBoundaryFallback state={state} />);
    expect(screen.getByRole('region').getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Connect and continue' }) as HTMLButtonElement).disabled).toBe(true);
    const retry = screen.getByRole('button', { name: 'Retry check' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(phase === 'checking');
    fireEvent.click(retry);
    expect(state.retry).toHaveBeenCalledTimes(phase === 'checking' ? 0 : 1);
  });

  it.each(['unauthorized', 'forbidden', 'error'] as const)('preserves %s diagnostics and offers recovery', (phase) => {
    state = { ...state, phase, message: 'Backend diagnostic detail' };
    render(<ConnectionBoundaryFallback state={state} />);
    expect(screen.getByRole('alert').textContent).toBe('Backend diagnostic detail');
    expect(screen.getByRole('button', { name: 'Connect and continue' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry check' })).toBeTruthy();
  });

  it('does not offer to connect a missing saved connection', () => {
    state = { ...state, phase: 'not-found' };
    render(<ConnectionBoundaryFallback state={state} />);
    expect(screen.getByRole('heading', { name: 'Connection not found' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect and continue' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry check' })).toBeTruthy();
  });
});
