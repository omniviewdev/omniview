import React from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Stack,
  Typography,
} from '@mui/joy';

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
      sx={{ '--Card-padding': '0px', '--Card-gap': '0px', borderRadius: 'sm', gap: '0px' }}
      variant='outlined'
    >
      <Box sx={{ py: 1, px: 1.25 }}>
        <Stack direction='row' spacing={1} alignItems='center' justifyContent='space-between'>
          <Stack spacing={0.25}>
            <Stack direction='row' spacing={1} alignItems='center'>
              {icon}
              <Typography level='title-sm'>{title}</Typography>
            </Stack>
            {description && (
              <Typography level='body-xs' color='neutral'>{description}</Typography>
            )}
          </Stack>
          <Stack direction='row' spacing={0.5}>
            {dangerAction && (
              <Button
                size='sm'
                variant='soft'
                color='danger'
                loading={dangerAction.loading}
                onClick={dangerAction.onClick}
              >
                {dangerAction.label}
              </Button>
            )}
            {onReset && (
              <Button size='sm' variant='plain' color='neutral' disabled={!dirty || saving} onClick={onReset}>
                Reset
              </Button>
            )}
            {onSave && (
              <Button size='sm' variant='soft' color='primary' disabled={!dirty || saving} loading={saving} onClick={onSave}>
                Save
              </Button>
            )}
          </Stack>
        </Stack>
      </Box>
      <Divider />
      <CardContent
        sx={{
          p: 1.5,
          backgroundColor: 'background.level1',
          borderBottomRightRadius: 6,
          borderBottomLeftRadius: 6,
        }}
      >
        {children}
      </CardContent>
    </Card>
  );
};

export default FormSection;
