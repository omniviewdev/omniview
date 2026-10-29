import { useState, type ReactNode } from 'react';
import { Button, Dialog, Input, Menu } from '@omniviewdev/base-ui';
import { currentWindow, useWindowsList } from '@/features/windows';
import { HOME_PATH } from '../pagePaths';
import { countTabs, findPaneOfTab, PAGE_GROUP_COLORS, type PageGroupColor, type PageTab } from '../pagesState';
import { canTabLeaveWindow } from '../workspaceController';
import { usePagesState, useWorkspaceController } from '../WorkspaceProvider';
import styles from './Workspace.module.css';

/** Theme-independent group colors, matching Chrome's palette. */
export const PAGE_GROUP_COLOR_VALUES: Record<PageGroupColor, string> = {
  grey: '#5f6368',
  blue: '#1a73e8',
  red: '#d93025',
  yellow: '#f9ab00',
  green: '#1e8e3e',
  pink: '#d01884',
  purple: '#9334e6',
  cyan: '#007b83',
  orange: '#fa903e',
};

export type MenuPoint = { x: number; y: number };

function logFailure(action: string) {
  return (error: unknown) => {
    console.error(`[workspace] ${action} failed`, error);
  };
}

function windowLabel(name: string): string {
  return name === 'main' ? 'Main window' : `Window ${name.replace(/^w-/, '')}`;
}

/** A menu opened at the pointer, closed by `onClose` once dismissed or an item ran. */
function PointerMenu({ point, onClose, label, children }: { point: MenuPoint; onClose: () => void; label: string; children: ReactNode }) {
  const [anchor] = useState(() => ({ getBoundingClientRect: () => new DOMRect(point.x, point.y, 0, 0) }));
  return (
    <Menu.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <Menu.Portal>
        <Menu.Positioner anchor={anchor} side='bottom' align='start' sideOffset={2}>
          <Menu.Popup aria-label={label} style={{ minWidth: 200 }}>
            {children}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Submenu({ label, children, disabled }: { label: string; children: ReactNode; disabled?: boolean }) {
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger showCaret disabled={disabled}>{label}</Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4}>
          <Menu.Popup>{children}</Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}

export function PageTabMenu({ tabId, point, onClose }: { tabId: string; point: MenuPoint; onClose: () => void }) {
  const controller = useWorkspaceController();
  const state = usePagesState();
  const windows = useWindowsList();
  const tab = state.tabs[tabId] as PageTab | undefined;
  const pane = findPaneOfTab(state, tabId);
  if (!tab || !pane) {
    return null;
  }

  const isSplit = state.panes.length > 1;
  const index = pane.tabIds.indexOf(tabId);
  const otherWorkspaceWindows = windows.filter((window) => window.kind === 'workspace' && window.name !== currentWindow.name);
  const canLeave = canTabLeaveWindow(state);
  // The only tab of a secondary window already is "a new window".
  const canMoveToNewWindow = canLeave && countTabs(state) > 1;

  return (
    <PointerMenu point={point} onClose={onClose} label='Tab actions'>
      <Menu.Item onClick={() => controller.openTabAfter(tabId, HOME_PATH)}>New tab to the right</Menu.Item>
      <Menu.Item onClick={() => {
        controller.duplicateTab(tabId); 
      }}>Duplicate</Menu.Item>
      <Menu.Item onClick={() => {
        controller.dispatch({ type: 'setPinned', tabId, pinned: !tab.pinned }); 
      }}>
        {tab.pinned ? 'Unpin' : 'Pin'}
      </Menu.Item>
      <Menu.Separator />
      <Submenu label='Add to group'>
        <Menu.Item onClick={() => {
          controller.addTabToNewGroup(tabId); 
        }}>New group</Menu.Item>
        {state.groups.filter((group) => group.id !== tab.groupId).map((group) => (
          <Menu.Item
            key={group.id}
            startDecorator={<span className={styles.ColorSwatch} style={{ background: PAGE_GROUP_COLOR_VALUES[group.color] }} />}
            onClick={() => {
              controller.dispatch({ type: 'addToGroup', tabId, groupId: group.id }); 
            }}
          >
            {group.title || 'Unnamed group'}
          </Menu.Item>
        ))}
      </Submenu>
      {tab.groupId && (
        <Menu.Item onClick={() => {
          controller.dispatch({ type: 'removeFromGroup', tabId }); 
        }}>Remove from group</Menu.Item>
      )}
      <Menu.Separator />
      <Menu.Item disabled={!isSplit && pane.tabIds.length === 1} onClick={() => {
        controller.splitTab(tabId); 
      }}>
        {isSplit ? 'Move to other pane' : 'Split right'}
      </Menu.Item>
      {isSplit && <Menu.Item onClick={() => {
        controller.dispatch({ type: 'unsplit' }); 
      }}>Close split view</Menu.Item>}
      <Menu.Item
        disabled={!canMoveToNewWindow}
        onClick={() => {
          controller.moveTabToNewWindow(tabId).catch(logFailure('moving the tab to a new window'));
        }}
      >
        Move to new window
      </Menu.Item>
      <Submenu label='Move to window' disabled={!canLeave || otherWorkspaceWindows.length === 0}>
        {otherWorkspaceWindows.map((window) => (
          <Menu.Item
            key={window.name}
            onClick={() => {
              controller.moveTabToWindow(tabId, window.name).catch(logFailure(`moving the tab to ${window.name}`));
            }}
          >
            {windowLabel(window.name)}
          </Menu.Item>
        ))}
      </Submenu>
      <Menu.Separator />
      <Menu.Item onClick={() => {
        controller.closeTabs([tabId]); 
      }}>Close</Menu.Item>
      <Menu.Item disabled={pane.tabIds.length === 1} onClick={() => {
        controller.closeOtherTabs(tabId); 
      }}>Close others</Menu.Item>
      <Menu.Item disabled={index === pane.tabIds.length - 1} onClick={() => {
        controller.closeTabsToTheRight(tabId); 
      }}>
        Close to the right
      </Menu.Item>
    </PointerMenu>
  );
}

export function PageGroupMenu({ groupId, point, onClose, onRename }: {
  groupId: string;
  point: MenuPoint;
  onClose: () => void;
  onRename: (groupId: string) => void;
}) {
  const controller = useWorkspaceController();
  const state = usePagesState();
  const group = state.groups.find((candidate) => candidate.id === groupId);
  if (!group) {
    return null;
  }

  return (
    <PointerMenu point={point} onClose={onClose} label='Group actions'>
      <Menu.Item onClick={() => {
        onRename(groupId); 
      }}>Rename…</Menu.Item>
      <Submenu label='Color'>
        {PAGE_GROUP_COLORS.map((color) => (
          <Menu.Item
            key={color}
            startDecorator={<span className={styles.ColorSwatch} style={{ background: PAGE_GROUP_COLOR_VALUES[color] }} />}
            onClick={() => {
              controller.dispatch({ type: 'updateGroup', groupId, changes: { color } }); 
            }}
          >
            {`${color[0].toUpperCase()}${color.slice(1)}${color === group.color ? ' ✓' : ''}`}
          </Menu.Item>
        ))}
      </Submenu>
      <Menu.Item onClick={() => {
        controller.dispatch({ type: 'updateGroup', groupId, changes: { collapsed: !group.collapsed } }); 
      }}>
        {group.collapsed ? 'Expand' : 'Collapse'}
      </Menu.Item>
      <Menu.Item onClick={() => {
        controller.dispatch({ type: 'ungroup', groupId }); 
      }}>Ungroup</Menu.Item>
      <Menu.Separator />
      <Menu.Item onClick={() => {
        controller.closeGroup(groupId); 
      }}>Close group</Menu.Item>
    </PointerMenu>
  );
}

export function RenameGroupDialog({ groupId, onClose }: { groupId: string; onClose: () => void }) {
  const controller = useWorkspaceController();
  const state = usePagesState();
  const [title, setTitle] = useState(() => state.groups.find((group) => group.id === groupId)?.title ?? '');
  const save = () => {
    controller.dispatch({ type: 'updateGroup', groupId, changes: { title: title.trim() } });
    onClose();
  };

  return (
    <Dialog open onClose={onClose} size='sm'>
      <Dialog.Title>Name this group</Dialog.Title>
      <Dialog.Body>
        <Input.Control
          size='sm'
          autoFocus
          aria-label='Group name'
          value={title}
          onChange={(event) => {
            setTitle(event.target.value); 
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              save();
            }
          }}
        />
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant='outline' color='neutral' size='sm' onClick={onClose}>Cancel</Button>
        <Button variant='solid' size='sm' onClick={save}>Save</Button>
      </Dialog.Footer>
    </Dialog>
  );
}
