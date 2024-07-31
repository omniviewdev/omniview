import React from 'react';

// Material-ui
import List from '@mui/joy/List';
import ListItem from '@mui/joy/ListItem';
import ListItemButton from '@mui/joy/ListItemButton';
import ListItemDecorator from '@mui/joy/ListItemDecorator';
import ListItemContent from '@mui/joy/ListItemContent';
import ListSubheader from '@mui/joy/ListSubheader';

// Custom
import Icon from '@/components/icons/Icon';
import { useLocation, Link } from 'react-router-dom';

type Props = {
  sections: Array<{ id: string; label: string; icon: string }>;
};

/**
 * The navigation content for the Trivy page.
 */
const TrivyNav: React.FC<Props> = ({ sections }) => {
  const location = useLocation();

  return (
    <List size='sm' sx={{ '--ListItem-radius': '8px', '--List-gap': '4px', p: 1 }}>
      <Link to='/trivy' style={{ textDecoration: 'none' }}>
        <ListItem key={'home'}>
          <ListItemButton
            selected={location.pathname === '/trivy'}
          >
            <ListItemDecorator>
              <Icon name={'LuGauge'} size={18} />
            </ListItemDecorator>
            <ListItemContent>{'Dashboard'}</ListItemContent>
          </ListItemButton>
        </ListItem>
      </Link>

      <Link to='/trivy/scan' style={{ textDecoration: 'none' }}>
        <ListItem key={'scan'}>
          <ListItemButton
            selected={location.pathname === '/trivy/scan'}
          >
            <ListItemDecorator>
              <Icon name={'LuRadar'} size={18} />
            </ListItemDecorator>
            <ListItemContent>{'Scan'}</ListItemContent>
          </ListItemButton>
        </ListItem>
      </Link>

      {/** Core section */}
      <ListItem nested>
        <ListSubheader>
          Reports
        </ListSubheader>
        <List size='sm' sx={{ '--ListItem-radius': '8px', '--List-gap': '4px' }}>
          {sections.map(section => (
            <Link to={`/trivy/${section.id}`} style={{ textDecoration: 'none' }}>
              <ListItem key={section.id}>
                <ListItemButton
                  selected={location.pathname.endsWith(section.id)}
                >
                  <ListItemDecorator>
                    <Icon name={section.icon} size={18} />
                  </ListItemDecorator>
                  <ListItemContent>{section.label}</ListItemContent>
                </ListItemButton>
              </ListItem>
            </Link>
          ))}
        </List>
      </ListItem>
    </List>
  );
};

export default TrivyNav;
