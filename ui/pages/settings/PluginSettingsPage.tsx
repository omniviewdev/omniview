import React from 'react';

// Material-ui
import { useTheme } from '@mui/joy/styles';
import Button from '@mui/joy/Button';
import Box from '@mui/joy/Box';
import Grid from '@mui/joy/Grid';
import Typography from '@mui/joy/Typography';
import Stack from '@mui/joy/Stack';
import Sheet from '@mui/joy/Sheet';
import useMediaQuery from '@mui/material/useMediaQuery';

// Types
import SettingsEntries from './SettingsEntries';
import { Section } from '.';
import { usePluginSettings } from '@/hooks/settings/usePluginSettings';
import { usePlugin } from '@/hooks/plugin/usePluginManager';
import { Avatar } from '@mui/joy';

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
      <Sheet
        variant='outlined'
        sx={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          borderRadius: 8,
          width: '100%',
          paddingY: 1,
          paddingX: 2,
          gap: 1.5,
        }}
      >
        <Avatar size='sm' src={plugin.data.metadata.icon} variant='plain' sx={{ borderRadius: 4, height: 20, width: 20 }} />
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
          <Typography level={isNormalScreenSize ? 'title-lg' : 'title-md'}>{plugin.data.metadata.name}</Typography>
          <Typography level={isNormalScreenSize ? 'body-xs' : 'body-xs'}>{plugin.data.metadata.description}</Typography>
        </Stack>
      </Sheet>

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
        <Grid xs={12} md={6} lg={8}>
          <Button
            fullWidth
            variant='soft'
            onClick={commitDraftValues}
            disabled={Object.values(draftValues).filter(v => v !== undefined).length === 0}
          >
            Save
          </Button>
        </Grid>
        <Grid xs={12} md={6} lg={4}>
          <Button
            fullWidth
            color='neutral'
            variant='soft'
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
