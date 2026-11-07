import { Component, lazy, memo } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionSettingsContributions, type ConnectionSettingsContext } from './connection-settings';

const state = vi.hoisted(() => ({ contributions: [] as unknown[] }));
vi.mock('./provider', () => ({ useExtensionPointSnapshot: () => state }));
afterEach(() => { cleanup(); state.contributions = []; });

const context: ConnectionSettingsContext = {
  resourcePluginID: 'kubernetes', connectionID: 'cluster-a', signal: 'metrics',
  catalogRevision: 'revision-a', publicMetadata: { cluster: 'public-cluster' }, resourceTypes: ['core::v1::Pod'],
};

describe('owner-placed connection settings', () => {
  it('passes only owner-approved context to matching typed contributions', () => {
    const view = vi.fn((props: ConnectionSettingsContext) => <span>{props.connectionID}</span>);
    state.contributions = [{ id: 'grafana', value: { contractVersion: 1, label: 'Metrics', signals: ['metrics'], component: view } }];
    render(<ConnectionSettingsContributions {...context} />);
    expect(screen.getByText('cluster-a')).toBeTruthy();
    expect(view.mock.calls[0][0]).toEqual(context);
  });

  it('renders memo, lazy and class contributions with owner context', async () => {
    const MemoView = memo((props: ConnectionSettingsContext) => <span>Memo {props.connectionID}</span>);
    const LazyView = lazy(async () => ({ default: (props: ConnectionSettingsContext) => <span>Lazy {props.connectionID}</span> }));
    class ClassView extends Component<ConnectionSettingsContext> {
      render() { return <span>Class {this.props.connectionID}</span>; }
    }
    state.contributions = [MemoView, LazyView, ClassView].map((component, id) => ({
      id: String(id), value: { contractVersion: 1, label: `Metrics ${id}`, signals: ['metrics'], component },
    }));
    render(<ConnectionSettingsContributions {...context} />);
    expect(screen.getByText('Memo cluster-a')).toBeTruthy();
    expect(screen.getByText('Class cluster-a')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Loading Metrics 1 settings…');
    expect(await screen.findByText('Lazy cluster-a')).toBeTruthy();
  });

  it('ignores unsupported versions and malformed signal contracts', () => {
    const view = vi.fn(() => <span>Invalid contribution</span>);
    state.contributions = [
      { id: 'future', value: { contractVersion: 2, signals: ['metrics'], component: view } },
      { id: 'malformed', value: { contractVersion: 1, component: view } },
      { id: 'other-signal', value: { contractVersion: 1, signals: ['logs'], component: view } },
      { id: 'invalid-component', value: { contractVersion: 1, signals: ['metrics'], component: {} } },
      { id: 'element-not-type', value: { contractVersion: 1, signals: ['metrics'], component: <span>Not a component type</span> } },
    ];
    render(<ConnectionSettingsContributions {...context} />);
    expect(view).not.toHaveBeenCalled();
  });
});
