import React from 'react'

// material-ui
import Divider from '@mui/joy/Divider'
import Stack from '@mui/joy/Stack'
import Typography from '@mui/joy/Typography'
import Chip from '@mui/joy/Chip';

// hooks
import { NamespaceSection } from '.';
import SettingsEntry from './SettingsEntry';
import { useSetting } from '@/hooks/useSettings';


type Props = NamespaceSection & {
  settings: Record<string, any>
  draftValues: Record<string, any>
  setDraftValues: (draftValues: Record<string, any>) => void
}

/**
 * Displays and allows modification to application settings, given a settings namespace and section.
 */
const SettingsEntries: React.FC<Props> = ({ namespaceID, sectionID, settings, draftValues, setDraftValues }) => {
  const showSettingID = useSetting('core.appearance.showSettingIds')

  const handleChange = (name: string, value: any) => {
    // if changing back to initial value, remove from draft values
    // otherwise, add to draft values
    if (value === settings[name].value) {
      setDraftValues({ ...draftValues, [name]: undefined })
    } else {
      setDraftValues({ ...draftValues, [name]: value })
    }
  }

  // todo - make this a bit better
  if (!settings) {
    return <></>
  }

  return (
    <Stack
      direction={'column'}
      width={'100%'}
      height={'100%'}
      overflow={'auto'}
      gap={3}
      flexGrow={1}
    >
      <Stack
        direction={'column'}
        justifyContent={'flex-start'}
        gap={2}
        sx={{
          // account for the 1px border highlight we put on the selected items
          // otherwise, it get's cut off
          px: 0.5,
          flexGrow: 1,
          overflow: 'scroll',
          // hide scrollbar
          '&::-webkit-scrollbar': { display: 'none' },
          scrollbarWidth: 'none',
        }}
      >
        {Object.entries(settings).map(([id, setting], idx) => (
          <div key={id}>
            <Stack key={id} direction={'column'} gap={1}>
              <Stack direction={'column'}>
                <Stack direction={'row'} justifyContent={'space-between'}>
                  <Typography level='title-md'>{setting.label}</Typography>
                  {showSettingID && <Chip size='sm' variant='outlined' sx={{ borderRadius: 4 }}>{`${namespaceID}.${sectionID}.${id}`}</Chip>}
                </Stack>
                <Typography level='body-sm'>{setting.description}</Typography>
              </Stack>

              <SettingsEntry setting={setting} id={id} draftValue={draftValues[id]} handleChange={handleChange} />
            </Stack>
            {idx !== Object.keys(settings).length - 1 && <Divider />}
          </div>
        ))}
      </Stack>
    </Stack>
  )
}

export default SettingsEntries;
