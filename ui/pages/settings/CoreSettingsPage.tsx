import React from 'react';

// Material-ui
import { useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import useMediaQuery from '@mui/material/useMediaQuery';
import { Button } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';

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
          <Text weight='semibold' size={isNormalScreenSize ? 'lg' : 'md'}>{settings.data.label}</Text>
          <Text size='xs'>{settings.data.description}</Text>
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
          section={Section.Core}
          id={categoryID}
          settings={settings.data.settings}
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

export default CoreSettingsPage;
