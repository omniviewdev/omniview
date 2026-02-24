import React from 'react';
import { useLocation, Link } from 'react-router-dom';

// Material-ui
import { List, ListItem, ListSubheader } from '@omniviewdev/ui';
import Box from '@mui/material/Box';

// Custom
import Icon from '@/components/icons/Icon';

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
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              p: 1,
              borderRadius: 1,
              cursor: 'pointer',
              width: '100%',
              bgcolor: location.pathname === '/trivy' ? 'action.selected' : 'transparent',
            }}
          >
            <Icon name={'LuGauge'} size={18} />
            <span>{'Dashboard'}</span>
          </Box>
        </ListItem>
      </Link>

      <Link to='/trivy/scan' style={{ textDecoration: 'none' }}>
        <ListItem key={'scan'}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              p: 1,
              borderRadius: 1,
              cursor: 'pointer',
              width: '100%',
              bgcolor: location.pathname === '/trivy/scan' ? 'action.selected' : 'transparent',
            }}
          >
            <Icon name={'LuRadar'} size={18} />
            <span>{'Scan'}</span>
          </Box>
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
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    p: 1,
                    borderRadius: 1,
                    cursor: 'pointer',
                    width: '100%',
                    bgcolor: location.pathname.endsWith(section.id) ? 'action.selected' : 'transparent',
                  }}
                >
                  <Icon name={section.icon} size={18} />
                  <span>{section.label}</span>
                </Box>
              </ListItem>
            </Link>
          ))}
        </List>
      </ListItem>
    </List>
  );
};

export default TrivyNav;
