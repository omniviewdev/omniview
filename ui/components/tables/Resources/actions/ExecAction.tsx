import React from 'react';

import { Menu } from '@omniviewdev/base-ui';

// third party
import jsonpath from 'jsonpath';

// icons
import { LuSquareTerminal } from 'react-icons/lu';

// types
import { type Handler } from '@omniviewdev/runtime/models';
import type { HostRecord } from '@omniviewdev/runtime';

// project imports
import ActionMenuListItem from './ActionMenuListItem';
import { resourceExecOptions } from './resourceExecOptions';
import { bottomDrawerChannel } from '@/providers/BottomDrawer/events';

type Props = {
  selected: boolean;
  handleSelect: () => void;
  handleDeselect: () => void;
  handleLeaveMenu: (getIsOnButton: () => boolean) => void;
  handleDismiss: () => void;
  itemProps: Record<string, unknown>;
  action: Handler;
  plugin: string;
  connection: string;
  resource: string;
  data: Record<string, unknown>;
  record: HostRecord;
};

type ExecTarget = {
  label: string;
  params: Record<string, string>;
};

const calcTargets = (action: Handler, data: Record<string, unknown>): ExecTarget[] => {
  const targets = [] as ExecTarget[];

  const datas = action.target_builder.paths.reduce<Array<Record<string, unknown>>>((acc, path) => {
    const values = jsonpath.query(data, path);
    if (Array.isArray(values)) {
      Array.prototype.push.apply(acc, values);
    } else {
      acc.push(values);
    }

    return acc;
  }, []);

  datas.forEach((data) => {
    const params: Record<string, string> = {};
    Object.entries(action.target_builder.selectors).forEach(([key, selector]) => {
      if (selector === undefined) {
        return;
      }

      params[key] = jsonpath.query(data, selector)[0] as string;
    });

    targets.push({
      params,
      label: action.target_builder.label_selector ? params[action.target_builder.label_selector] : action.target_builder.label,
    });
  });

  return targets;
};

const ExecAction: React.FC<Props> = ({
  selected,
  handleSelect,
  handleDeselect,
  handleLeaveMenu,
  action,
  plugin,
  connection,
  data,
  record,
  itemProps,
  handleDismiss,
}) => {
  const targets = calcTargets(action, data);

  /**
   * Perform the exec action on the resource target.
   */
  const handlePerformExec = (label: string, params: Record<string, string>) => {
    const opts = resourceExecOptions(record.record.body, params,
      action.default_command?.length ? action.default_command : ['/bin/sh'],
      record.record.reference, record.route);

    bottomDrawerChannel.emit('onCreateSession', { plugin, connection, opts, label });
  };

  return (
    <ActionMenuListItem
      label="Exec"
      icon={<LuSquareTerminal />}
      open={selected}
      onOpen={handleSelect}
      onLeaveMenu={handleLeaveMenu}
      menu={
        <>
          {targets.map((target) => (
            <Menu.Item
              key={target.label}
              onClick={() => {
                handlePerformExec(target.label, target.params);
                handleDeselect();
                if (typeof itemProps.onClick == 'function') {
                  (itemProps.onClick as () => void)();
                }

                handleDismiss();
              }}
            >
              {target.label}
            </Menu.Item>
          ))}
        </>
      }
    >
      Exec
    </ActionMenuListItem>
  );
};

export default ExecAction;
