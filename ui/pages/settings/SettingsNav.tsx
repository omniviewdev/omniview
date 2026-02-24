import React from 'react';

// Material-ui
import { List, ListItem, ListSubheader, Avatar } from '@omniviewdev/ui';

// Custom
import Icon from '@/components/icons/Icon';
import { type SectionSelection, Section } from '.';
import { useSettingsProvider } from '@/hooks/settings/useCoreSettings';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import { IsImage } from '@/utils/url';
import Box from '@mui/material/Box';

type Props = {
  selected: SectionSelection;
  onChange: (selection: { section: Section; id: string }) => void;
};

/**
 * The navigation content for the settings page.
 */
const SettingsNav: React.FC<Props> = ({ selected, onChange }) => {
  // Get the core settings sections
  const { settings } = useSettingsProvider();
  const { plugins } = usePluginManager();

  if (settings.isLoading || plugins.isLoading) {
    return null;
  }

  if (settings.isError || !settings.data) {
    return null;
  }

  return (
    <List
      size='sm'
      sx={{
        '--ListItem-radius': '8px',
        '--List-padding': '8px',
        '--List-gap': '6px',
      }}>
      {/** Core section */}
      <ListItem key={Section.Core} nested>
        <ListSubheader>
          {Section.Core}
        </ListSubheader>
        <List
          aria-labelledby='nav-list-browse'
          sx={{
            '& .JoyListItemButton-root': { p: '8px' },
            '--List-gap': '0px',
          }}
        >
          {Object.values(settings.data).map(category => (
            <ListItem key={category.id}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  p: '8px',
                  borderRadius: 1,
                  cursor: 'pointer',
                  width: '100%',
                  bgcolor: selected.id === category.id && selected.section === Section.Core ? 'action.selected' : 'transparent',
                }}
                onClick={() => {
                  onChange({ section: Section.Core, id: category.id });
                }}
              >
                <Icon name={category.icon} />
                <span>{category.label}</span>
              </Box>
            </ListItem>
          ))}

          <ListItem key={'extensions'}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                p: '8px',
                borderRadius: 1,
                cursor: 'pointer',
                width: '100%',
                bgcolor: selected.id === 'extensions' && selected.section === Section.Core ? 'action.selected' : 'transparent',
              }}
              onClick={() => {
                onChange({ section: Section.Core, id: 'extensions' });
              }}
            >
              <Icon name={'LuBrainCircuit'} />
              <span>{'Extensions'}</span>
            </Box>
          </ListItem>

        </List>
      </ListItem>

      {/** Plugins section */}
      <ListItem key={Section.Plugins} nested>
        <ListSubheader>
          {Section.Plugins}
        </ListSubheader>
        <List
          aria-labelledby='nav-list-browse'
          sx={{
            '& .JoyListItemButton-root': { p: '8px' },
            '--List-gap': '0px',
          }}
        >
          {plugins.data?.map(plugin => (
            <ListItem key={plugin.id}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  p: '8px',
                  borderRadius: 1,
                  cursor: 'pointer',
                  width: '100%',
                  bgcolor: selected.id === plugin.id && selected.section === Section.Plugins ? 'action.selected' : 'transparent',
                }}
                onClick={() => {
                  onChange({ section: Section.Plugins, id: plugin.id });
                }}
              >
                {IsImage(plugin.metadata?.icon) ? (
                  <Avatar
                    size='sm'
                    src={plugin.metadata.icon}
                    sx={{
                      borderRadius: 4,
                      backgroundColor: 'transparent',
                      objectFit: 'contain',
                      border: 0,
                      width: 20,
                      height: 20,
                    }}
                  />
                ) : <Icon name={plugin.metadata.icon} />}
                <span>{plugin.metadata.name}</span>
              </Box>
            </ListItem>
          ))}
        </List>
      </ListItem>
    </List>
  );
};

export default SettingsNav;
