import React, { useCallback, useMemo, useState, useSyncExternalStore } from 'react';

import { IconButton, Menu, SplitButton } from '@omniviewdev/base-ui';

import { parseAppError, useNotifications, type DrawerComponentAction, type DrawerContext, type DrawerComponentActionListItem } from '@omniviewdev/runtime';
import HintTooltip from '@/components/base/HintTooltip';
import styles from './RightDrawerActions.module.css';

type Props<T = any> = {
  ctx: DrawerContext;
  actions: Array<DrawerComponentAction<T>>;
};

/**
 * Displays the menu of actions available for the drawer component
 */
const RightDrawerActions: React.FC<Props> = ({ ctx, actions }) => {
  if (!actions.length) {
    return <></>;
  }

  return (
    <div id={'actions-menu'} className={styles.ActionsMenu}>
      {actions.map((action, i) => <RightDrawerAction key={i} ctx={ctx} action={action} />)}
    </div>
  );
};

const noopUnsubscribe = () => undefined;
const RightDrawerAction: React.FC<{ ctx: DrawerContext; action: DrawerComponentAction }> = ({ ctx, action }) => {
  const [open, setOpen] = useState(false);
  const subscribe = useCallback(
    (onChange: () => void) => action.externalStore?.subscribe(ctx, onChange) ?? noopUnsubscribe,
    [action.externalStore, ctx],
  );
  const getSnapshot = useCallback(() => action.externalStore?.getSnapshot(ctx), [action.externalStore, ctx]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const { notify } = useNotifications();
  const runAction = async (callback: () => void | Promise<unknown>) => {
    try {
      await callback();
    } catch (cause) {
      const error = parseAppError(cause);
      void notify({ title: error.title || 'Action failed', severity: 'error', details: error.detail });
    }
  };

  const checkIsDisabled = () => {
    if (action.enabled === undefined) {
      return false;
    }

    if (typeof action.enabled === 'function') {
      return !action.enabled((ctx));
    }

    return !action.enabled;
  };

  const listItems = useMemo((): DrawerComponentActionListItem[] => {
    if (!action.list) {
      return [];
    }

    if (typeof action.list === 'function') {
      return action.list(ctx, snapshot);
    }

    return action.list;
  }, [action, ctx, snapshot]);

  const splitItems = useMemo(() => {
    const list = action.splitMenu?.list;
    return typeof list === 'function' ? list(ctx, snapshot) : list ?? [];
  }, [action.splitMenu, ctx, snapshot]);

  const actionTitle = typeof action.title === 'string' ? action.title : '';
  const dividerBefore = actionTitle === 'Start' || actionTitle === 'Delete';

  const wrapped = (node: React.ReactNode) => (
    <div className={dividerBefore ? `${styles.ActionWrap} ${styles.ActionWrapDivided}` : styles.ActionWrap}>
      {node}
    </div>
  );

  if (action.splitMenu) {
    const primaryDisabled = checkIsDisabled()
      || (!action.list && !action.action)
      || (!!action.list && (listItems.length === 0 || listItems.every(item => item.disabled)));
    const primary = (
      <SplitButton.Action
        aria-label={actionTitle || undefined}
        title={actionTitle || undefined}
        disabled={primaryDisabled}
        onClick={listItems.length > 1 ? undefined : () => {
          void runAction(async () => {
            if (action.list) {
              if (!listItems[0]?.disabled) {
                await listItems[0]?.action(ctx);
              }
            } else {
              await action.action?.(ctx);
            }
          });
        }}
      >
        {action.icon}
      </SplitButton.Action>
    );
    return wrapped(
      <SplitButton size='sm' variant='ghost' color='neutral' className={styles.SplitAction}>
        {listItems.length > 1 ? (
          <Menu.Root>
            <Menu.Trigger disabled={primaryDisabled} render={primary} />
            <Menu.Portal>
              <Menu.Positioner align='end' sideOffset={4}>
                <Menu.Popup size='sm'>
                  {listItems.map((item, i) => (
                    <Menu.Item key={i} disabled={item.disabled} startDecorator={item.icon}
                      onClick={() => {
                        if (!item.disabled) {
                          void runAction((): void | Promise<unknown> => item.action(ctx));
                        }
                      }}>
                      {item.title}
                    </Menu.Item>
                  ))}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        ) : primary}
        <SplitButton.Menu
          menuAriaLabel={action.splitMenu.title}
          disabled={checkIsDisabled() || splitItems.length === 0 || splitItems.every(item => item.disabled)}
        >
          {splitItems.map((item, i) => (
            <Menu.Item key={i} disabled={item.disabled} startDecorator={item.icon}
              onClick={() => {
                if (!item.disabled) {
                  void runAction((): void | Promise<unknown> => item.action(ctx));
                }
              }}>
              {item.title}
            </Menu.Item>
          ))}
        </SplitButton.Menu>
      </SplitButton>,
    );
  }

  // Simple action button (no list)
  if (!!action.action && !action.list) {
    return wrapped(
      <HintTooltip content={action.title} side='top'>
        <span className={styles.TriggerWrap}>
          <IconButton
            size='sm'
            variant='ghost'
            color='neutral'
            aria-label={actionTitle === '' ? undefined : actionTitle}
            disabled={checkIsDisabled()}
            onClick={() => {
              void runAction(async () => action.action?.(ctx));
            }}
          >
            {action.icon}
          </IconButton>
        </span>
      </HintTooltip>,
    );
  }

  // List action with single item: click directly triggers the action
  if (!!action.list && listItems.length === 1) {
    return wrapped(
      <HintTooltip content={action.title} side='top'>
        <span className={styles.TriggerWrap}>
          <IconButton
            size='sm'
            variant='ghost'
            color='neutral'
            aria-label={actionTitle === '' ? undefined : actionTitle}
            disabled={checkIsDisabled() || listItems[0].disabled}
            onClick={() => {
              if (listItems[0].disabled) {
                return;
              }

              void runAction(async () => listItems[0].action(ctx));
            }}
          >
            {action.icon}
          </IconButton>
        </span>
      </HintTooltip>,
    );
  }

  // List action with multiple items: hover to show menu
  if (!!action.list && listItems.length > 1) {
    return wrapped(
      <Menu.Root open={open} onOpenChange={setOpen}>
        <HintTooltip content={action.title} side='top' disabled={open}>
          <Menu.Trigger
            openOnHover
            delay={0}
            closeDelay={150}
            disabled={checkIsDisabled()}
            render={
              <IconButton
                size='sm'
                variant='ghost'
                color='neutral'
                aria-label={actionTitle === '' ? undefined : actionTitle}
              >
                {action.icon}
              </IconButton>
            }
          />
        </HintTooltip>
        <Menu.Portal>
          <Menu.Positioner align='end' sideOffset={4}>
            <Menu.Popup size='sm'>
              {listItems.map((item, i) => (
                <Menu.Item
                  key={i}
                  startDecorator={item.icon}
                  disabled={item.disabled}
                  onClick={() => {
                    if (item.disabled) {
                      return;
                    }

                    void runAction(async () => item.action(ctx));
                    setOpen(false);
                  }}
                >
                  {item.title}
                </Menu.Item>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>,
    );
  }

  return <></>;
};


export default RightDrawerActions;
