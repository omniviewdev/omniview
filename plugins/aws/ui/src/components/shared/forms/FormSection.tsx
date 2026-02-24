import React from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { Button } from '@omniviewdev/ui/buttons';
import { Card } from '@omniviewdev/ui';

type Props = {
  title: string;
  icon?: React.ReactNode;
  description?: string;
  children: React.ReactNode;
  onSave?: () => void;
  onReset?: () => void;
  dirty?: boolean;
  saving?: boolean;
  /** Show a danger-styled action button (e.g., for delete operations) */
  dangerAction?: {
    label: string;
    onClick: () => void;
    loading?: boolean;
  };
};

const FormSection: React.FC<Props> = ({
  title,
  icon,
  description,
  children,
  onSave,
  onReset,
  dirty,
  saving,
  dangerAction,
}) => {
  return (
    <Card
      sx={{ '--Card-padding': '0px', '--Card-gap': '0px', borderRadius: 1, gap: '0px' }}
      variant='outlined'
    >
      <Box sx={{ py: 1, px: 1.25 }}>
        <Stack direction='row' spacing={1} alignItems='center' justifyContent='space-between'>
          <Stack spacing={0.25}>
            <Stack direction='row' spacing={1} alignItems='center'>
              {icon}
              <Text weight="semibold" size="sm">{title}</Text>
            </Stack>
            {description && (
              <Text size="xs" color="neutral">{description}</Text>
            )}
          </Stack>
          <Stack direction='row' spacing={0.5}>
            {dangerAction && (
              <Button
                size='sm'
                emphasis='soft'
                color='error'
                onClick={dangerAction.onClick}
              >
                {dangerAction.loading ? 'Loading...' : dangerAction.label}
              </Button>
            )}
            {onReset && (
              <Button size='sm' emphasis='ghost' color='neutral' disabled={!dirty || saving} onClick={onReset}>
                Reset
              </Button>
            )}
            {onSave && (
              <Button size='sm' emphasis='soft' color='primary' disabled={!dirty || saving} onClick={onSave}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            )}
          </Stack>
        </Stack>
      </Box>
      <Divider />
      <Box
        sx={{
          p: 1.5,
          backgroundColor: 'background.paper',
          borderBottomRightRadius: 6,
          borderBottomLeftRadius: 6,
        }}
      >
        {children}
      </Box>
    </Card>
  );
};

export default FormSection;
