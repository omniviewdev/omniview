import React from 'react';

// Material-ui
import Box from '@mui/material/Box';
import { Button } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { Avatar } from '@omniviewdev/ui';

// Types
import SettingsEntries from './SettingsEntries';
import { Section } from '.';
import { usePluginSettings } from '@/hooks/settings/usePluginSettings';
import { usePlugin } from '@/hooks/plugin/usePluginManager';
import { useSnackbar } from '@omniviewdev/runtime';

type Props = {
  id: string;
};

/**
 * View and modify settings for a given plugin.
 */
const PluginSettingsPage: React.FC<Props> = ({ id }) => {
  const [draftValues, setDraftValues] = React.useState<Record<string, any>>({});

  const { plugin } = usePlugin({ id });
  const { settings, setSettings } = usePluginSettings({ plugin: id });
  const { showSnackbar } = useSnackbar();

  const hasDrafts = Object.values(draftValues).some(v => v !== undefined);

  const commitDraftValues = () => {
    const values = Object.entries(draftValues).reduce<Record<string, any>>((acc, [id, value]) => {
      if (value !== undefined) {
        id = id.split('.')[1];
        acc[id] = value;
      }
      return acc;
    }, {});

    setSettings(values).then(() => {
      clearDraftValues();
      showSnackbar({ message: 'Settings saved', status: 'success', autoHideDuration: 2000 });
    }).catch((err) => {
      const msg = typeof err === 'string' ? err : err?.message ?? String(err);
      showSnackbar({ message: 'Failed to save settings', status: 'error', details: msg });
    });
  };

  const clearDraftValues = () => {
    setDraftValues({});
  };

  if (settings.isLoading || settings.isError || !settings.data || !plugin.data) {
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
        <Avatar size='sm' src={plugin.data.metadata.icon} sx={{ borderRadius: '4px', height: 22, width: 22 }} />
        <Stack direction='column' gap={0.25}>
          <Text weight='semibold' size='lg'>{plugin.data.metadata.name}</Text>
          <Text size='xs' sx={{ color: 'text.secondary' }}>{plugin.data.metadata.description}</Text>
        </Stack>
      </Box>

      {/* Settings form */}
      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <SettingsEntries
          section={Section.Plugins}
          id={id}
          settings={settings.data}
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

export default PluginSettingsPage;
