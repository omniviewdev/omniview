import React from 'react';

// material-ui
import Menu from '@mui/joy/Menu';
import MenuItem from '@mui/joy/MenuItem';
import ListItem from '@mui/joy/ListItem';
import Typography from '@mui/joy/Typography';

// third party
import jsonpath from 'jsonpath';

// icons
import { LuSquareTerminal } from 'react-icons/lu';

// types
import { exec } from '@omniviewdev/runtime/models';

// project imports
import ActionMenuListItem from './ActionMenuListItem';
import { bottomDrawerChannel } from '@/providers/BottomDrawer/events';

/** Command to detect the shell */
const DefaultShellCmd = ['/bin/sh', '-c', 'stty -echo && /bin/sh'];

type Props = {
  selected: boolean;
  handleSelect: () => void;
  handleDeselect: () => void;
  handleLeaveMenu: (getIsOnButton: () => boolean) => void;
  handleDismiss: () => void;
  itemProps: Record<string, unknown>;
  action: exec.Handler;
  plugin: string;
  connection: string;
  resource: string;
  data: Record<string, unknown>;
};

type ExecTarget = {
  label: string;
  params: Record<string, string>;
};

const calcTargets = (action: exec.Handler, data: Record<string, unknown>): ExecTarget[] => {
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
  resource,
  data,
  itemProps,
  handleDismiss,
}) => {
  const targets = calcTargets(action, data);

  /**
   * Perform the exec action on the resource target.
   */
  const handlePerformExec = (label: string, params: Record<string, string>) => {
    /* eslint-disable @typescript-eslint/naming-convention */
    const opts = exec.SessionOptions.createFrom({
      params,
      resource_plugin: plugin,
      resource_key: resource,
      resource_data: data,
      command: DefaultShellCmd,
      tty: true,
    });

    bottomDrawerChannel.emit('onCreateSession', { plugin, connection, opts, label });
  };

  return (
    <ListItem>
      <ActionMenuListItem
        label="Exec"
        icon={<LuSquareTerminal />}
        open={selected}
        onOpen={handleSelect}
        onLeaveMenu={handleLeaveMenu}
        menu={
          <Menu
            size='sm'
            sx={{
              padding: 0,
            }}
            onClose={handleDeselect}
          >
            {targets.map((target) => (
              <MenuItem
                key={target.label}
                {...itemProps}
                onClick={() => {
                  handlePerformExec(target.label, target.params);
                  handleDeselect();
                  if (typeof itemProps.onClick == 'function') {
                    itemProps.onClick();
                  }

                  handleDismiss();
                }}
              >
                <Typography level='body-sm'>{target.label}</Typography>
              </MenuItem>
            ))}
          </Menu>
        }
      >
        Exec
      </ActionMenuListItem>
    </ListItem>
  );
};

export default ExecAction;
