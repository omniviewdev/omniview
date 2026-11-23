import { Button, DataTable, Icon, IconButton, Stack, Text, menuTrigger, useMenu, type DataTableColumn, type MenuItem } from '@omniviewdev/kit';
import { useMemo, useState, type ReactNode } from 'react';
import styles from './Menu.examples.module.css';

type Select = (label: string) => void;
type Action = Extract<MenuItem, { readonly kind: 'action' }>;
type ActionOptions = Omit<Action, 'kind' | 'id' | 'label' | 'onSelect'>;

function action(id: string, label: string, select: Select, options?: ActionOptions): Action {
  return {
    kind: 'action', id, label, ...options,
    onSelect: () => {
      select(label);
    },
  };
}

function Result({ value }: { readonly value: string }) {
  return <output><Text variant="caption" tone="muted">Last action: {value}</Text></output>;
}

function Scene({ children, last }: { readonly children: ReactNode; readonly last: string }) {
  return (
    <div className={styles.scene}>
      <Stack gap={8}>
        <div className={styles.toolbar}>{children}</div>
        <Result value={last} />
      </Stack>
    </div>
  );
}

/** The workspace header's overflow: available commands first, then organization actions that need a saved view or folder. */
export const WorkspaceOverflow = () => {
  const [last, setLast] = useState('nothing');
  const menu = useMenu(() => [
    action('create-folder', 'Create folder…', setLast, { icon: 'folder-tree' }),
    action('save-view', 'Save view…', setLast, { icon: 'layout-template' }),
    { kind: 'separator', id: 'organize' },
    action('organize-folders', 'Organize folders…', setLast, { icon: 'folder-tree', disabled: 'No folders to organize' }),
    action('organize-views', 'Organize saved views…', setLast, { icon: 'layout-template', disabled: 'No saved views to organize' }),
    action('organize-home', 'Organize Home sections…', setLast, { icon: 'list-ordered', disabled: 'No custom sections to organize' }),
  ]);
  return (
    <Scene last={last}>
      <Button size="compact" icon="settings-2" onClick={() => {
        setLast('Open workspace settings');
      }}>Workspace settings</Button>
      <IconButton icon="refresh" label="Refresh workspace" onClick={() => {
        setLast('Refresh workspace');
      }} />
      <IconButton {...menuTrigger(menu)} icon="ellipsis" label="Workspace actions" />
    </Scene>
  );
};

const TARGETS = ['checkout', 'payments', 'catalog', 'cert-manager', 'ingress'] as const;

/** A panel's terminal picker: labeled groups, keyboard hints, recent-target metadata and nested remote targets. */
export const TerminalTargets = () => {
  const [last, setLast] = useState('nothing');
  const menu = useMenu(() => [
    { kind: 'group', id: 'local', label: 'Local', items: [
      action('zsh', 'Local shell (zsh)', setLast, {
        icon: 'server',
        shortcut: '⌃⇧`',
        hints: [{ keys: '↵', spokenKeys: 'Enter', label: 'Open terminal' }],
      }),
      action('bash', 'Local shell (bash)', setLast, { icon: 'server' }),
    ] },
    { kind: 'separator', id: 'before-recent' },
    { kind: 'group', id: 'recent', label: 'Recent', items: [
      action('recent-zsh', 'Local shell (zsh)', setLast, { icon: 'server', metadata: { text: 'This computer', icon: 'server' } }),
    ] },
    { kind: 'separator', id: 'before-cloud' },
    { kind: 'group', id: 'cloud', label: 'Cloud · acme-prod', items: [
      { kind: 'submenu', id: 'ssm', label: 'SSM session', icon: 'globe', items: [
        action('instance-a', 'instance-a', (label) => {
          setLast(`Open SSM session on ${label}`);
        }),
        action('instance-b', 'instance-b', (label) => {
          setLast(`Open SSM session on ${label}`);
        }),
      ] },
    ] },
    { kind: 'separator', id: 'before-cluster' },
    { kind: 'group', id: 'cluster', label: 'Cluster · prod-eu', items: TARGETS.map<MenuItem>((target) => ({
      kind: 'submenu', id: target, label: target, icon: 'blocks', items: [
        action('app', 'app', (label) => {
          setLast(`Open ${target} / ${label}`);
        }),
        action('sidecar', 'sidecar', (label) => {
          setLast(`Open ${target} / ${label}`);
        }),
      ],
    })) },
  ]);
  return (
    <Scene last={last}>
      <Text>Operations</Text>
      <IconButton icon="plus" label="Open local shell" variant="ghost" onClick={() => {
        setLast('Local shell (zsh)');
      }} />
      <IconButton {...menuTrigger(menu)} icon="chevron-down" label="Terminal targets" />
    </Scene>
  );
};

/** Right-click either tab, or focus it and press Shift+F10, to act on that tab. Ordinary click switches tabs. */
export const TabContext = () => {
  const [last, setLast] = useState('nothing');
  const [active, setActive] = useState('Connections');
  const menu = useMenu((tab) => {
    if (tab === undefined) {
      return null;
    }

    const select = (label: string) => {
      setLast(`${label}: ${tab}`);
    };

    return [
      action('new', 'New tab to the right', select),
      action('duplicate', 'Duplicate tab', select),
      action('pin', 'Pin tab', select),
      action('reload', 'Reload tab', select),
      { kind: 'separator', id: 'before-move' },
      action('split', 'Split right', select),
      action('new-window', 'Move to new window', select),
      { kind: 'submenu', id: 'move', label: 'Move to window', items: [
        action('secondary', 'Window 2', (label) => {
          select(`Move to ${label}`);
        }),
        action('tertiary', 'Window 3', (label) => {
          select(`Move to ${label}`);
        }),
      ] },
      { kind: 'separator', id: 'before-close' },
      action('close', 'Close tab', select, { shortcut: '⌘W' }),
      action('close-other', 'Close other tabs', select),
      action('close-right', 'Close tabs to the right', select),
      action('close-left', 'Close tabs to the left', select),
      action('close-unpinned', 'Close all but pinned', select),
      { kind: 'separator', id: 'before-reopen' },
      action('reopen', 'Reopen closed tab', select, { shortcut: '⌘⇧T', disabled: 'No closed tabs to reopen' }),
    ];
  });
  return (
    <Scene last={last}>
      {['Connections', 'Nodes'].map((tab) => (
        <Button key={tab} {...menuTrigger(menu, tab, 'context')} data-ov-menu-label={`Actions for ${tab}`} icon="layout-template" size="compact" variant={active === tab ? 'secondary' : 'ghost'} onClick={() => {
          setActive(tab);
          setLast(`Open ${tab}`);
        }}>{tab}</Button>
      ))}
    </Scene>
  );
};

/** A row's more menu: quick view gets first focus, and destructive removal is separated from connection commands. */
export const ConnectionActions = () => {
  const [last, setLast] = useState('nothing');
  const menu = useMenu((connection) => {
    if (connection === undefined) {
      return null;
    }

    const select = (label: string) => {
      setLast(`${label}: ${connection}`);
    };

    return [
      action('quick-view', 'Quick view', select, { icon: 'eye' }),
      action('open', 'Open', select, { icon: 'blocks' }),
      action('new-tab', 'Open in new tab', select, { icon: 'copy' }),
      action('new-window', 'Open in new window', select, { icon: 'arrow-right' }),
      { kind: 'separator', id: 'before-organize' },
      action('pin', 'Pin', select, { icon: 'target' }),
      action('folders', 'Folders…', select, { icon: 'folder-tree' }),
      action('edit', 'Edit name and tags…', select, { icon: 'file-cog' }),
      { kind: 'separator', id: 'before-connection' },
      action('connect', 'Connect', select, { icon: 'network', disabled: 'Already connected' }),
      action('check', 'Check connection', select, { icon: 'check' }),
      action('disconnect', 'Disconnect…', select, { icon: 'split' }),
      action('settings', 'Connection settings', select, { icon: 'settings-2' }),
      { kind: 'separator', id: 'before-remove' },
      action('remove', 'Remove connection…', select, { icon: 'trash', destructive: true }),
    ];
  });
  return (
    <Scene last={last}>
      <Text>prod-eu</Text>
      <Button size="row" onClick={() => {
        setLast('Open: prod-eu');
      }}>Open</Button>
      <IconButton {...menuTrigger(menu, 'prod-eu')} data-ov-menu-pointer-focus="first" size="row" icon="ellipsis" label="Actions for prod-eu" />
    </Scene>
  );
};

/** Toggle a mixed checkbox, or change a radio selection. Reopen to see the current state. */
export const ViewOptions = () => {
  const [status, setStatus] = useState<boolean | 'mixed'>('mixed');
  const [order, setOrder] = useState('recent');
  const menu = useMenu(() => [
    { kind: 'checkbox', id: 'status', label: 'Show status', checked: status, onChange: setStatus },
    { kind: 'separator', id: 'before-sort' },
    { kind: 'radio', id: 'sort', label: 'Sort by', value: order, onChange: setOrder, options: [
      { id: 'recent', label: 'Most recent' },
      { id: 'name', label: 'Name' },
    ] },
  ]);
  const visibility = status === 'mixed' ? 'Mixed status visibility' : status ? 'Show status' : 'Hide status';
  return (
    <Scene last={`${visibility}; sort by ${order === 'recent' ? 'most recent' : 'name'}`}>
      <IconButton {...menuTrigger(menu)} icon="columns" label="View options" />
    </Scene>
  );
};

// Only the structural browser probe supplies this callback; the timing run does not instrument the resolver.
type ProbeWindow = Window & { readonly __kitMenuResolverProbe?: (contextKey: string | undefined) => void };

const VIRTUAL_COUNT = 20_000;
const STATES = ['Running', 'Paused', 'Running', 'Failed', 'Running'] as const;
type Workload = { readonly key: string; readonly name: string; readonly state: (typeof STATES)[number] };
const getRowKey = (row: Workload) => row.key;

function Workloads({ count, lines = 1 }: { readonly count: number; readonly lines?: 1 | 2 }) {
  const [rows] = useState<readonly Workload[]>(() => Array.from({ length: count }, (_, index) => ({
    key: String(index + 1),
    name: `worker-${index + 1}`,
    state: STATES[index % STATES.length] ?? 'Running',
  })));
  const [last, setLast] = useState('nothing');
  // Resolve the row directly, and create its actions only when its menu opens.
  const menu = useMenu((key) => {
    if (count === VIRTUAL_COUNT) {
      (window as ProbeWindow).__kitMenuResolverProbe?.(key);
    }

    const row = key === undefined ? undefined : rows[Number(key) - 1];
    if (row === undefined || row.key !== key) {
      return null;
    }

    const select = (verb: string) => () => {
      setLast(`${verb} ${row.name}`);
    };

    return [
      { kind: 'action', id: 'inspect', label: 'Inspect', onSelect: select('inspect') },
      ...(lines === 2 ? [
        { kind: 'action', id: 'pause', label: 'Pause', disabled: row.state !== 'Running', onSelect: select('pause') },
        { kind: 'action', id: 'resume', label: 'Resume', disabled: row.state !== 'Paused', onSelect: select('resume') },
      ] as const : [
        { kind: 'action', id: 'rerun', label: 'Run again', onSelect: select('rerun') },
        { kind: 'action', id: 'copy', label: 'Copy name', onSelect: select('copy') },
      ] as const),
      { kind: 'separator', id: 'before-delete' },
      { kind: 'action', id: 'delete', label: 'Delete…', destructive: true, onSelect: select('delete') },
    ];
  });
  const columns = useMemo<ReadonlyArray<DataTableColumn<Workload>>>(() => [
    {
      id: 'name', header: 'Name', fit: 'flex',
      text: (row) => lines === 2 ? [{ text: row.name }, { text: row.state, font: 'small' }] : row.name,
      cell: (row) => lines === 2 ? <>{row.name}<br />{row.state}</> : row.name,
    },
    {
      id: 'actions', header: 'Actions', hideHeader: true, fit: 'fixed', width: 48,
      cell: (row) => (
        <button type="button" className={styles.rowTrigger} aria-label={`Actions for ${row.name}`} data-ov-menu-label="Workload actions" {...menuTrigger(menu, row.key)}>
          <Icon name="ellipsis" />
        </button>
      ),
    },
  ], [lines, menu]);
  return (
    <div className={styles.scene}>
      <Stack gap={8}>
        <DataTable label="Workloads" rows={rows} getRowKey={getRowKey} columns={columns} lines={lines} maxHeight={count > 12 || lines === 2 ? 360 : 320} rowsAreImmutable />
        <Result value={last} />
      </Stack>
    </div>
  );
}

/** Twenty thousand rows share the root host. Only visible and overscan rows have triggers; each trigger is just a button and its glyph. */
export const VirtualRows = () => <Workloads count={VIRTUAL_COUNT} />;

/** Twelve rows with the same single-line size and the same three-element trigger as the virtual table. */
export const SmallRows = () => <Workloads count={12} />;

/** Actions use the opening row's state: a paused workload can resume, while a failed one can do neither. */
export const TwoLineRows = () => <Workloads count={12} lines={2} />;
