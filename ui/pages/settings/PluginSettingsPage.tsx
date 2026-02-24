import React from 'react';

// Material-ui
import { useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import useMediaQuery from '@mui/material/useMediaQuery';
import { Button } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { Avatar } from '@omniviewdev/ui';

// Types
import SettingsEntries from './SettingsEntries';
import { Section } from '.';
import { usePluginSettings } from '@/hooks/settings/usePluginSettings';
import { usePlugin } from '@/hooks/plugin/usePluginManager';

type Props = {
  id: string;
};

/**
 * View and modify settings for a given plugin
 */
const PluginSettingsPage: React.FC<Props> = ({ id }) => {
  const theme = useTheme();
  const [draftValues, setDraftValues] = React.useState<Record<string, any>>({});
  const isNormalScreenSize = useMediaQuery(theme.breakpoints.up('lg'));

  const { plugin } = usePlugin({ id });
  const { settings, setSettings } = usePluginSettings({ plugin: id });

  /**
   * Commit the drafted settings into the settings store.
   */
  const commitDraftValues = () => {
    const values = Object.entries(draftValues).reduce<Record<string, any>>((acc, [id, value]) => {
      if (value !== undefined) {
        id = id.split('.')[1];
        acc[id] = value;
      }

      return acc;
    }, {});

    console.log('committing', values);
    setSettings(values).then(() => {
      clearDraftValues();
    }).catch((err) => {
      console.error('Failed to save settings', err);
    });
  };

  /**
  * Clear the drafted settings.
  */
  const clearDraftValues = () => {
    setDraftValues({});
  };

  if (settings.isLoading) {
    return null;
  }

  if (settings.isError || !settings.data || !plugin.data) {
    return null;
  }

  return (
    <Stack
      direction={'column'}
      gap={2}
      sx={{
        width: '100%',
        maxWidth: '100%',
        height: '100%',
        maxHeight: '100%',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          borderRadius: 2,
          width: '100%',
          py: 1,
          px: 2,
          gap: 1.5,
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Avatar size='sm' src={plugin.data.metadata.icon} sx={{ borderRadius: 4, height: 20, width: 20 }} />
        <Stack
          sx={{
            display: 'flex',
            flexDirection: {
              xs: 'column',
              lg: 'row',
            },
            justifyContent: {
              xs: 'flex-start',
              lg: 'space-between',
            },
            alignItems: {
              xs: 'flex-start',
              lg: 'center',
            },
            borderRadius: 6,
            width: '100%',
          }}
        >
          <Text weight='semibold' size={isNormalScreenSize ? 'lg' : 'md'}>{plugin.data.metadata.name}</Text>
          <Text size='xs'>{plugin.data.metadata.description}</Text>
        </Stack>
      </Box>

      {/* Render the settings section here */}
      <Box
        sx={{
          width: '100%',
          overflow: 'auto',
          display: 'flex',
          flexGrow: 1,
        }}
      >
        <SettingsEntries
          section={Section.Plugins}
          id={id}
          settings={settings.data}
          draftValues={draftValues}
          setDraftValues={setDraftValues}
        />
      </Box>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6, lg: 8 }}>
          <Button
            fullWidth
            emphasis='soft'
            onClick={commitDraftValues}
            disabled={Object.values(draftValues).filter(v => v !== undefined).length === 0}
          >
            Save
          </Button>
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <Button
            fullWidth
            color='neutral'
            emphasis='soft'
            onClick={clearDraftValues}
            disabled={Object.values(draftValues).filter(v => v !== undefined).length === 0}
          >
            Cancel
          </Button>
        </Grid>
      </Grid>
    </Stack>
  );
};

export default PluginSettingsPage;
