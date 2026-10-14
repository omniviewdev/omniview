import React, { useMemo, useState } from 'react';

import { IconButton, Menu } from '@omniviewdev/base-ui';

import { type DrawerComponentAction, type DrawerContext, type DrawerComponentActionListItem } from '@omniviewdev/runtime';
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

const RightDrawerAction: React.FC<{ ctx: DrawerContext; action: DrawerComponentAction }> = ({ ctx, action }) => {
  const [open, setOpen] = useState(false);

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
      return action.list(ctx);
    }

    return action.list || [];
  }, [action.list, ctx]);

  const actionTitle = typeof action.title === 'string' ? action.title : '';
  const dividerBefore = actionTitle === 'Start' || actionTitle === 'Delete';

  const wrapped = (node: React.ReactNode) => (
    <div className={dividerBefore ? `${styles.ActionWrap} ${styles.ActionWrapDivided}` : styles.ActionWrap}>
      {node}
    </div>
  );

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
            onClick={() => action.action?.(ctx)}
          >
            {action.icon}
          </IconButton>
        </span>
      </HintTooltip>
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
            disabled={checkIsDisabled()}
            onClick={() => {
              listItems[0].action(ctx); 
            }}
          >
            {action.icon}
          </IconButton>
        </span>
      </HintTooltip>
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
                  onClick={() => {
                    item.action(ctx);
                    setOpen(false);
                  }}
                >
                  {item.title}
                </Menu.Item>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    );
  }

  return <></>;
};


export default RightDrawerActions;
