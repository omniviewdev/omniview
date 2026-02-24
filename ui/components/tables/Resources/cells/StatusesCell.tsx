import React from 'react';

// material-ui
import { Stack } from '@omniviewdev/ui/layout';
import { Tooltip } from '@omniviewdev/ui/overlays';
import { useTheme } from '@mui/material/styles';

import jsonpath from 'jsonpath';
import PluginComponent from '@/federation';

type Status = 'success' | 'warning' | 'danger' | 'neutral';

type Props = {
  /** Plugin id */
  plugin: string;
  /** The values to use for calculating the badge colors */
  values: string[];
  /** Determines how to get the status value out of the object */
  statusAccessor: string;
  /** Status map */
  statusMap: Record<string, Status>;
  /** The horizontal alignment of the text. Default is 'left' */
  align?: 'left' | 'right' | 'center' | 'justify';
  /** Custom hover menu component, if specified **/
  hoverMenuComponent?: string;
};

export const ContainerStatusCell: React.FC<Props> = ({ plugin, values, statusAccessor, statusMap, hoverMenuComponent }) => {
  const theme = useTheme();

  /** Get the color for the chip based on the status */
  const getColor = (data: any) => {
    const value = jsonpath.query(data, statusAccessor)[0];
    const status = statusMap[value] ?? 'neutral';

    switch (status) {
      case 'success':
        return theme.palette.success[400];
      case 'warning':
        return theme.palette.warning[400];
      case 'danger':
        return theme.palette.danger[400];
      case 'neutral':
        return theme.palette.neutral[400];
    }
  };

  return (
    <Stack direction="row" width={'100%'} alignItems={'center'} justifyContent={'flex-start'} spacing={1}>
      {values.map((status) => (
        <Tooltip
          placement="top-end"
          emphasis="soft"
          sx={{
            border: (theme) => `1px solid ${theme.palette.divider}`,
          }}
          content={hoverMenuComponent
            ? <PluginComponent
              plugin={plugin}
              component={hoverMenuComponent}
              fallback={<React.Fragment />}
              data={status}
            />
            : null
          }
        >
          <div
            color={getColor(status)}
            style={{
              backgroundColor: getColor(status),
              borderRadius: 3, 
              width: 10, 
              height: 10, 
              maxWidth: 10, 
              maxHeight: 10, 
              minWidth: 10, 
              minHeight: 10,
            }}
          />
        </Tooltip>
      ))}
    </Stack>
  );
};

export default ContainerStatusCell;
