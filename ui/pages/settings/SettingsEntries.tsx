import React from 'react';

// Material-ui
import Box from '@mui/material/Box';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';

// Types
import { type SectionSelection } from '.';
import SettingsEntry from './SettingsEntry';
import { type settings } from '@omniviewdev/runtime/models';

type Props = SectionSelection & {
  settings: Record<string, settings.Setting>;
  draftValues: Record<string, any>;
  setDraftValues: (draftValues: Record<string, any>) => void;
};

/**
 * Displays and allows modification to application settings, given a settings namespace and section.
 */
const SettingsEntries: React.FC<Props> = ({ id: sectionID, settings, draftValues, setDraftValues }) => {
  const handleChange = (name: string, value: any) => {
    const id = `${sectionID}.${name}`;
    setDraftValues({ ...draftValues, [id]: value });
  };

  if (!settings) {
    return <></>;
  }

  return (
    <Stack
      direction='column'
      width='100%'
      height='100%'
      overflow='auto'
      gap={0}
      flexGrow={1}
      sx={{
        '&::-webkit-scrollbar': { display: 'none' },
        scrollbarWidth: 'none',
      }}
    >
      {Object.entries(settings).map(([id, setting], index) => (
        <Box
          key={id}
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', md: 'row' },
            gap: { xs: 1, md: 4 },
            alignItems: { xs: 'stretch', md: 'flex-start' },
            py: 2.5,
            borderBottom: index < Object.keys(settings).length - 1 ? '1px solid' : 'none',
            borderColor: 'divider',
          }}
        >
          {/* Label + description column */}
          <Stack direction='column' gap={0.5} sx={{ flex: '0 0 240px', minWidth: 240 }}>
            <Text weight='semibold' size='sm'>{setting.label}</Text>
            <Text size='xs' sx={{ color: 'text.secondary', lineHeight: 1.5 }}>{setting.description}</Text>
            {sectionID !== 'plugin' && (
              <Text size='xs' sx={{ color: 'text.disabled', fontFamily: 'monospace', fontSize: '0.625rem' }}>
                {sectionID}.{id}
              </Text>
            )}
          </Stack>
          {/* Input column */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <SettingsEntry
              setting={setting}
              id={id}
              draftValue={draftValues[`${sectionID}.${id}`]}
              handleChange={handleChange}
            />
          </Box>
        </Box>
      ))}
    </Stack>
  );
};

export default SettingsEntries;
