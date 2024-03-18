import React from 'react';

// material-ui
import IconButton from '@mui/joy/IconButton';
import List from '@mui/joy/List';
import ListSubheader from '@mui/joy/ListSubheader';
import ListItem from '@mui/joy/ListItem';
import ListItemButton from '@mui/joy/ListItemButton';
import ListItemDecorator from '@mui/joy/ListItemDecorator';
import ListItemContent from '@mui/joy/ListItemContent';

// Icons import
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';

// custom
import Icon from '@/components/icons/Icon';
import { SectionSelection, Section } from '.';
import { useSettingsProvider } from '@/hooks/settings/useCoreSettings';

type Props = {
  selected: SectionSelection;
  onChange: (selection: { section: Section, id: string }) => void;
}

/**
 * The navigation content for the settings page.
 */
const SettingsNav: React.FC<Props> = ({ selected, onChange }) => {
  // get the core settings sections
  const { settings } = useSettingsProvider()

  if (settings.isLoading) return null
  if (settings.isError || !settings.data) return null

  return (
    <List size="sm" sx={{ '--ListItem-radius': '8px', '--List-gap': '4px' }}>
      {/** Core section */}
      <ListItem key={Section.Core} nested>
        <ListSubheader>
          {Section.Core}
          <IconButton
            size="sm"
            variant="outlined"
            color="primary"
            sx={{ '--IconButton-size': '24px', ml: 'auto' }}
          >
            <KeyboardArrowDownRoundedIcon fontSize="small" color="primary" />
          </IconButton>
        </ListSubheader>
        <List
          aria-labelledby="nav-list-browse"
          sx={{
            '& .JoyListItemButton-root': { p: '8px' },
          }}
        >
          {Object.values(settings.data).map((category) => (
            <ListItem key={category.id}>
              <ListItemButton
                selected={selected.id === category.id && selected.section === Section.Core}
                onClick={() => onChange({ section: Section.Core, id: category.id })}
              >
                <ListItemDecorator>
                  <Icon name={category.icon} />
                </ListItemDecorator>
                <ListItemContent>{category.label}</ListItemContent>
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </ListItem>
    </List>
  );
}

export default SettingsNav;
