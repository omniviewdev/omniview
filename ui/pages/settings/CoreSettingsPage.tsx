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

// Project imports
import Icon from '@/components/icons/Icon';

// Types
import { useCategorySettings } from '@/hooks/settings/useCategorySettings';
import SettingsEntries from './SettingsEntries';
import { Section } from '.';
import { useSettings } from '@omniviewdev/runtime';

type Props = {
  id: string;
};

/**
 * View and modify settings for a given namespace and section.
 */
const CoreSettingsPage: React.FC<Props> = ({ id: categoryID }) => {
  const theme = useTheme();
  const [draftValues, setDraftValues] = React.useState<Record<string, any>>({});
  const isNormalScreenSize = useMediaQuery(theme.breakpoints.up('lg'));

  const { settings, setSettings } = useCategorySettings({ category: categoryID });
  const { reload } = useSettings()

  /**
   * Commit the drafted settings into the settings store.
   */
  const commitDraftValues = () => {
    const values = Object.entries(draftValues).reduce<Record<string, any>>((acc, [id, value]) => {
      if (value !== undefined) {
        acc[id] = value;
      }

      return acc;
    }, {});

    console.log('committing', values);
    setSettings(values).then(() => {
      clearDraftValues();
      reload();
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

  if (settings.isError || !settings.data) {
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
        <Icon name={settings.data.icon} size={isNormalScreenSize ? 20 : 30} />
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
          <Typography level={isNormalScreenSize ? 'title-lg' : 'title-md'}>{settings.data.label}</Typography>
          <Typography level={isNormalScreenSize ? 'body-xs' : 'body-xs'}>{settings.data.description}</Typography>
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
          section={Section.Core}
          id={categoryID}
          settings={settings.data.settings}
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

export default CoreSettingsPage;
