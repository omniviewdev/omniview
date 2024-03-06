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
import { useSettingsSections } from '@/hooks/useSettings';
import Icon from '@/components/icons/Icon';
import { NamespaceSection } from '.';

type Props = {
  selected: NamespaceSection;
  onChange: (selection: { namespaceID: string, sectionID: string }) => void;
}

/**
 * The navigation content for the settings page.
 */
const SettingsNav: React.FC<Props> = ({ selected, onChange }) => {
  const namespaces = useSettingsSections()

  return (
    <List size="sm" sx={{ '--ListItem-radius': '8px', '--List-gap': '4px' }}>

      {/* Each namespace get's it's own section in the nav */}
      {namespaces.map((namespace, idx) => (
        <ListItem key={namespace.id} nested sx={{ pt: idx !== 0 ? 2 : 0 }}>
          <ListSubheader>
            {namespace.label}
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
            {/** Each section should appear as a single item under the namespace */}
            {namespace.sections.map((section) => (
              <ListItem key={section.id}>
                <ListItemButton
                  selected={selected.sectionID === section.id && selected.namespaceID === namespace.id}
                  onClick={() => onChange({ namespaceID: namespace.id, sectionID: section.id })}
                >
                  <ListItemDecorator>
                    <Icon name={section.icon} />
                  </ListItemDecorator>
                  <ListItemContent>{section.label}</ListItemContent>
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </ListItem>
      ))}
    </List>
  );
}

export default SettingsNav;
