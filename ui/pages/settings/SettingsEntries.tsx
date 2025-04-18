import React from 'react';

// Material-ui
import Stack from '@mui/joy/Stack';
import Typography from '@mui/joy/Typography';
import Chip from '@mui/joy/Chip';

// Types
import { type SectionSelection } from '.';
import SettingsEntry from './SettingsEntry';
import { type settings } from '@api/models';

type Props = SectionSelection & {
  settings: Record<string, settings.Setting>;
  draftValues: Record<string, any>;
  setDraftValues: (draftValues: Record<string, any>) => void;
};

/**
 * Displays and allows modification to application settings, given a settings namespace and section.
 */
const SettingsEntries: React.FC<Props> = ({ id: sectionID, settings, draftValues, setDraftValues }) => {
  const showSettingID = true; // Todo - make this a setting

  const handleChange = (name: string, value: any) => {
    const id = `${sectionID}.${name}`;
    console.log(value)
    console.log(typeof value)

    // If changing back to initial value, remove from draft values
    // otherwise, add to draft values
    setDraftValues({ ...draftValues, [id]: value });
  };

  // Todo - make this a bit better
  if (!settings) {
    return <></>;
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
        gap={4}
        sx={{
          // Account for the 1px border highlight we put on the selected items
          // otherwise, it get's cut off
          px: 0.5,
          flexGrow: 1,
          overflow: 'scroll',
          // Hide scrollbar
          '&::-webkit-scrollbar': { display: 'none' },
          scrollbarWidth: 'none',
        }}
      >
        {Object.entries(settings).map(([id, setting]) => (
          <div key={id}>
            <Stack key={id} direction={'column'} gap={0.5}>
              <Stack direction={'column'}>
                <Stack direction={'row'} justifyContent={'space-between'}>
                  <Typography level='title-sm'>{setting.label}</Typography>
                  {showSettingID && sectionID !== 'plugin' && <Chip size='sm' variant='outlined' sx={{ borderRadius: 4 }}>{`${sectionID}.${id}`}</Chip>}
                  {showSettingID && sectionID === 'plugin' && <Chip size='sm' variant='outlined' sx={{ borderRadius: 4 }}>{`${id}`}</Chip>}
                </Stack>
                <Typography level='body-xs' color='neutral'>{setting.description}</Typography>
              </Stack>
              <SettingsEntry
                setting={setting}
                id={id}
                draftValue={draftValues[`${sectionID}.${id}`]}
                handleChange={handleChange}
              />
            </Stack>
          </div>
        ))}
      </Stack>
    </Stack>
  );
};

export default SettingsEntries;
