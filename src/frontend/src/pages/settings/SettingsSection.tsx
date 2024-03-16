import React from 'react';
import { useDispatch } from 'react-redux';

// material-ui
import { useTheme } from '@mui/joy/styles';
import Button from '@mui/joy/Button';
import Box from '@mui/joy/Box';
import Grid from '@mui/joy/Grid';
import Typography from '@mui/joy/Typography';
import Stack from '@mui/joy/Stack';
import Sheet from '@mui/joy/Sheet';
import useMediaQuery from '@mui/material/useMediaQuery';

// project imports
import { useSectionSettings, useSettingsNamespaceSection } from '@/hooks/useSettings';
import Icon from '@/components/icons/Icon';
import SettingsEntries from './SettingsEntries';
import { batchSetSettingValues } from '@/store/settings/slice';
import { useSnackbar } from '@/providers/SnackbarProvider';


// types
import { NamespaceSection } from '.';

type Props = NamespaceSection

/**
 * View and modify settings for a given namespace and section.
 */
const SettingsSection: React.FC<Props> = ({ namespaceID, sectionID }) => {
  const theme = useTheme();
  const dispatch = useDispatch()
  const { showSnackbar } = useSnackbar()

  const section = useSettingsNamespaceSection(namespaceID, sectionID)

  // icon should be the same height both text lines on smaller devices
  const isNormalScreenSize = useMediaQuery(theme.breakpoints.up('lg'));

  const settings = useSectionSettings(namespaceID, sectionID)
  const [draftValues, setDraftValues] = React.useState<Record<string, any>>({})

  /**
   * Commit the drafted settings into the settings store.
   */
  const commitDraftValues = () => {
    const values = Object.entries(draftValues).reduce((acc, [id, value]) => {
      if (value !== undefined) {
        acc[`${namespaceID}.${sectionID}.${id}`] = value
      }
      return acc
    }, {} as Record<string, any>)

    try {
      dispatch(batchSetSettingValues({ values }))
      showSnackbar('Settings saved', 'success')
      setDraftValues({})
    } catch (e) {
      if (e instanceof Error && e.message !== "cancelled") {
        showSnackbar(`Error saving settings: ${e}`, 'error')
      }
    }
  }

  /**
  * Clear the drafted settings.
  */
  const clearDraftValues = () => {
    setDraftValues({})
  }

  if (!section) return (<></>)

  return (
    <Stack
      direction={'column'}
      // justifyContent={'space-between'}
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
          borderRadius: 12,
          width: '100%',
          padding: 2,
          gap: 1.5,
        }}
      >
        <Icon name={section.icon} size={isNormalScreenSize ? 20 : 30} />
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
            borderRadius: 12,
            width: '100%'
          }}
        >
          <Typography level={isNormalScreenSize ? 'title-lg' : 'title-md'}>{section.label}</Typography>
          <Typography level={isNormalScreenSize ? 'body-sm' : 'body-xs'}>{section.description}</Typography>
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
          sectionID={sectionID}
          namespaceID={namespaceID}
          settings={settings}
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
  )
}

export default SettingsSection;
