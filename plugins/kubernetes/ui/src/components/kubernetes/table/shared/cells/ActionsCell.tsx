import React from 'react';
import { ObjectMeta } from 'kubernetes-types/meta/v1';

// UI components
import { IconButton } from '@omniviewdev/ui/buttons';
import { DropdownMenu, type ContextMenuItem } from '@omniviewdev/ui/menus';

// Icons
import { MoreHorizRounded } from '@mui/icons-material';
import { LuTrash } from 'react-icons/lu';

// Runtime
import {
  type DrawerComponentAction,
  type DrawerContext,
  useConfirmationModal,
} from '@omniviewdev/runtime';
import { ResourceClient } from '@omniviewdev/runtime/api';

// Table context
import { useTableDrawer } from '../../../../shared/table/TableDrawerContext';

type Props = {
  connectionID: string;
  resourceID: string;
  resourceKey: string;
  data: unknown;
  namespace: string;
};

/**
 * Build a DrawerContext from the table cell props so drawer actions
 * can be invoked with the correct row data.
 */
function buildDrawerContext(props: Props): DrawerContext {
  const meta = (props.data as { metadata?: ObjectMeta })?.metadata;
  return {
    data: props.data,
    resource: {
      id: meta?.name ?? props.resourceID,
      key: props.resourceKey,
      connectionID: props.connectionID,
      pluginID: 'kubernetes',
    },
  };
}

/**
 * Convert the drawer's DrawerComponentAction array into ContextMenuItems
 * that the DropdownMenu can render (with nested submenus, icons, dividers).
 */
function actionsToMenuItems(
  actions: DrawerComponentAction[],
  ctx: DrawerContext,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];

  // Separate delete from other actions
  const deleteActions: { action: DrawerComponentAction; disabled: boolean }[] = [];
  const otherActions: { action: DrawerComponentAction; disabled: boolean }[] = [];

  for (const action of actions) {
    const isEnabled = action.enabled === undefined
      ? true
      : typeof action.enabled === 'function'
        ? action.enabled(ctx)
        : action.enabled;

    const label = typeof action.title === 'string' ? action.title : '';
    const entry = { action, disabled: !isEnabled };
    if (label.toLowerCase() === 'delete') {
      deleteActions.push(entry);
    } else {
      otherActions.push(entry);
    }
  }

  // Add non-delete actions first
  for (let i = 0; i < otherActions.length; i++) {
    const { action, disabled } = otherActions[i];
    const label = typeof action.title === 'string' ? action.title : `action-${i}`;
    const item: ContextMenuItem = {
      key: label,
      label,
      icon: action.icon,
      disabled,
      // Add divider after the last non-delete action (before the delete group)
      dividerAfter: i === otherActions.length - 1 && deleteActions.length > 0,
    };

    if (!disabled && action.list) {
      const listItems = typeof action.list === 'function'
        ? action.list(ctx)
        : action.list;

      item.children = listItems.map((listItem, j) => ({
        key: `${label}-${j}`,
        label: typeof listItem.title === 'string' ? listItem.title : `${label}-item-${j}`,
        icon: listItem.icon,
        onClick: () => listItem.action(ctx),
      }));
    } else if (!disabled && action.action) {
      item.onClick = () => action.action!(ctx);
    }

    items.push(item);
  }

  // Add delete actions at the end with danger color
  for (const { action, disabled } of deleteActions) {
    const label = typeof action.title === 'string' ? action.title : 'Delete';
    items.push({
      key: 'delete',
      label,
      icon: action.icon,
      color: 'danger',
      disabled,
      onClick: !disabled && action.action ? () => action.action!(ctx) : undefined,
    });
  }

  return items;
}

const ActionsCell: React.FC<Props> = (props) => {
  const drawer = useTableDrawer();
  const { show } = useConfirmationModal();

  const ctx = React.useMemo(() => buildDrawerContext(props), [
    props.connectionID,
    props.resourceKey,
    props.resourceID,
    props.data,
    props.namespace,
  ]);

  const items = React.useMemo<ContextMenuItem[]>(() => {
    const drawerActions = drawer?.actions;
    if (drawerActions && drawerActions.length > 0) {
      return actionsToMenuItems(drawerActions, ctx);
    }

    // Fallback: no drawer actions — provide a built-in Delete
    return [buildFallbackDelete(props, ctx, show)];
  }, [drawer?.actions, ctx, show, props.connectionID, props.resourceKey, props.namespace]);

  if (items.length === 0) return null;

  return (
    <DropdownMenu
      placement="bottom-end"
      items={items}
      trigger={
        <IconButton
          size="sm"
          emphasis="ghost"
          sx={{ flex: 'none', minHeight: 28, minWidth: 28 }}
        >
          <MoreHorizRounded />
        </IconButton>
      }
    />
  );
};

/**
 * Build a fallback Delete menu item for tables that don't define their own
 * delete action in the drawer.
 */
function buildFallbackDelete(
  props: Props,
  _ctx: DrawerContext,
  show: ReturnType<typeof useConfirmationModal>['show'],
): ContextMenuItem {
  const meta = (props.data as { metadata?: ObjectMeta })?.metadata;
  const resourceName = meta?.name ?? props.resourceID;

  return {
    key: 'delete',
    label: 'Delete',
    icon: <LuTrash size={14} />,
    color: 'danger',
    onClick: () => {
      show({
        title: `Delete ${resourceName}?`,
        body: `Are you sure you want to delete ${resourceName}${props.namespace ? ` from ${props.namespace}` : ''}?`,
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        onConfirm: async () => {
          await ResourceClient.Delete(
            'kubernetes',
            props.connectionID,
            props.resourceKey,
            { id: resourceName, namespace: props.namespace, input: {}, params: {} } as any,
          );
        },
      });
    },
  };
}

ActionsCell.displayName = 'ActionsCell';
export default ActionsCell;
