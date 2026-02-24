import React from 'react';

// @omniviewdev/ui
import { useTheme } from '@mui/material/styles';
import { Stack } from '@omniviewdev/ui/layout';
import { Tooltip } from '@omniviewdev/ui/overlays';

import jsonpath from 'jsonpath';

type Status = 'success' | 'warning' | 'danger' | 'neutral';

type Props = {
  plugin: string;
  values: string[];
  statusAccessor: string;
  statusMap: Record<string, Status>;
  align?: 'left' | 'right' | 'center' | 'justify';
  hoverMenuComponent?: string;
};

export const ContainerStatusCell: React.FC<Props> = ({ values, statusAccessor, statusMap, hoverMenuComponent }) => {
  const theme = useTheme();

  const getColor = (data: any) => {
    const value = jsonpath.query(data, statusAccessor)[0];
    const status = statusMap[value] ?? 'neutral';

    switch (status) {
      case 'success':
        return theme.palette.success.main;
      case 'warning':
        return theme.palette.warning.main;
      case 'danger':
        return theme.palette.error.main;
      case 'neutral':
        return theme.palette.grey[400];
    }
  };

  return (
    <Stack direction="row" sx={{ width: '100%' }} alignItems='center' justifyContent='flex-start' gap={1}>
      {values.map((status) => (
        <Tooltip
          placement="top-end"
          content={hoverMenuComponent}
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
