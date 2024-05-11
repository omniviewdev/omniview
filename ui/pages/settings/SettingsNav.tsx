import React from 'react';

// Material-ui
import IconButton from '@mui/joy/IconButton';
import List from '@mui/joy/List';
import ListSubheader from '@mui/joy/ListSubheader';
import ListItem from '@mui/joy/ListItem';
import ListItemButton from '@mui/joy/ListItemButton';
import ListItemDecorator from '@mui/joy/ListItemDecorator';
import ListItemContent from '@mui/joy/ListItemContent';

// Icons import
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';

// Custom
import Icon from '@/components/icons/Icon';
import { type SectionSelection, Section } from '.';
import { useSettingsProvider } from '@/hooks/settings/useCoreSettings';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import { Avatar } from '@mui/joy';

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
    <List size='sm' sx={{ '--ListItem-radius': '8px', '--List-gap': '4px' }}>
      {/** Core section */}
      <ListItem key={Section.Core} nested>
        <ListSubheader>
          {Section.Core}
          <IconButton
            size='sm'
            variant='outlined'
            color='primary'
            sx={{ '--IconButton-size': '24px', ml: 'auto' }}
          >
            <KeyboardArrowDownRoundedIcon fontSize='small' color='primary' />
          </IconButton>
        </ListSubheader>
        <List
          aria-labelledby='nav-list-browse'
          sx={{
            '& .JoyListItemButton-root': { p: '8px' },
          }}
        >
          {Object.values(settings.data).map(category => (
            <ListItem key={category.id}>
              <ListItemButton
                selected={selected.id === category.id && selected.section === Section.Core}
                onClick={() => {
                  onChange({ section: Section.Core, id: category.id });
                }}
              >
                <ListItemDecorator>
                  <Icon name={category.icon} />
                </ListItemDecorator>
                <ListItemContent>{category.label}</ListItemContent>
              </ListItemButton>
            </ListItem>
          ))}

          <ListItem key={'extensions'}>
            <ListItemButton
              selected={selected.id === 'extensions' && selected.section === Section.Core}
              onClick={() => {
                onChange({ section: Section.Core, id: 'extensions' });
              }}
            >
              <ListItemDecorator>
                <Icon name={'LuBrainCircuit'} />
              </ListItemDecorator>
              <ListItemContent>{'Extensions'}</ListItemContent>
            </ListItemButton>
          </ListItem>

        </List>
      </ListItem>

      {/** Plugins section */}
      <ListItem key={Section.Plugins} nested>
        <ListSubheader>
          {Section.Plugins}
          <IconButton
            size='sm'
            variant='outlined'
            color='primary'
            sx={{ '--IconButton-size': '24px', ml: 'auto' }}
          >
            <KeyboardArrowDownRoundedIcon fontSize='small' color='primary' />
          </IconButton>
        </ListSubheader>
        <List
          aria-labelledby='nav-list-browse'
          sx={{
            '& .JoyListItemButton-root': { p: '8px' },
          }}
        >
          {plugins.data?.map(plugin => (
            <ListItem key={plugin.id}>
              <ListItemButton
                selected={selected.id === plugin.id && selected.section === Section.Plugins}
                onClick={() => {
                  onChange({ section: Section.Plugins, id: plugin.id });
                }}
              >
                <ListItemDecorator>
                  <Avatar size='sm' src={plugin.metadata.icon} variant='plain' sx={{ borderRadius: 4, height: 20, width: 20 }} />
                </ListItemDecorator>
                <ListItemContent>{plugin.metadata.name}</ListItemContent>
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </ListItem>
    </List>
  );
};

export default SettingsNav;
