import React from 'react';

// Material-ui
import Box from '@mui/material/Box';
import { Button } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';

// Project imports
import Icon from '@/components/icons/Icon';

// Types
import { useCategorySettings } from '@/hooks/settings/useCategorySettings';
import SettingsEntries from './SettingsEntries';
import { Section } from '.';
import { useSettings, useSnackbar } from '@omniviewdev/runtime';

type Props = {
  id: string;
};

/**
 * View and modify settings for a given namespace and section.
 */
const CoreSettingsPage: React.FC<Props> = ({ id: categoryID }) => {
  const [draftValues, setDraftValues] = React.useState<Record<string, any>>({});

  const { settings, setSettings } = useCategorySettings({ category: categoryID });
  const { reload } = useSettings();
  const { showSnackbar } = useSnackbar();

  const hasDrafts = Object.values(draftValues).some(v => v !== undefined);

  const commitDraftValues = () => {
    const values = Object.entries(draftValues).reduce<Record<string, any>>((acc, [id, value]) => {
      if (value !== undefined) {
        acc[id] = value;
      }
      return acc;
    }, {});

    setSettings(values).then(() => {
      clearDraftValues();
      reload();
      showSnackbar({ message: 'Settings saved', status: 'success', autoHideDuration: 2000 });
    }).catch((err) => {
      const msg = typeof err === 'string' ? err : err?.message ?? String(err);
      showSnackbar({ message: 'Failed to save settings', status: 'error', details: msg });
    });
  };

  const clearDraftValues = () => {
    setDraftValues({});
  };

  if (settings.isLoading || settings.isError || !settings.data) {
    return null;
  }

  return (
    <Stack
      direction='column'
      gap={0}
      sx={{
        width: '100%',
        height: '100%',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          pb: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Icon name={settings.data.icon} size={22} />
        <Stack direction='column' gap={0.25}>
          <Text weight='semibold' size='lg'>{settings.data.label}</Text>
          <Text size='xs' sx={{ color: 'text.secondary' }}>{settings.data.description}</Text>
        </Stack>
      </Box>

      {/* Settings form */}
      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <SettingsEntries
          section={Section.Core}
          id={categoryID}
          settings={settings.data.settings}
          draftValues={draftValues}
          setDraftValues={setDraftValues}
        />
      </Box>

      {/* Action bar */}
      {hasDrafts && (
        <Box
          sx={{
            display: 'flex',
            gap: 1,
            pt: 2,
            mt: 1,
            borderTop: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Button
            color='primary'
            emphasis='soft'
            onClick={commitDraftValues}
          >
            Save Changes
          </Button>
          <Button
            color='neutral'
            emphasis='ghost'
            onClick={clearDraftValues}
          >
            Discard
          </Button>
        </Box>
      )}
    </Stack>
  );
};

export default CoreSettingsPage;
