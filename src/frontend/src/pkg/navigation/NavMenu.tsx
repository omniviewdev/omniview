import React from 'react';

// Material-ui
import Avatar from '@mui/joy/Avatar';
import IconButton from '@mui/joy/IconButton';
import List from '@mui/joy/List';
import ListSubheader from '@mui/joy/ListSubheader';
import ListItem from '@mui/joy/ListItem';
import ListItemButton from '@mui/joy/ListItemButton';
import ListItemDecorator from '@mui/joy/ListItemDecorator';
import ListItemContent from '@mui/joy/ListItemContent';
import Stack from '@mui/joy/Stack';

// Icons import
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';

// Custom
import { type SidebarListItemProps, type SidebarProps } from './types';
import { Typography } from '@mui/joy';

/**
 * Render a navigation menu in a sidebar layout
 */
const NavMenu: React.FC<SidebarProps> = ({ header, size, items, sections, scrollable, selected, onSelect }) => {
  if (items == null && sections == null) {
    throw new Error('You must pass either items or sections');
  }

  if (Boolean(items?.length) && Boolean(sections?.length)) {
    throw new Error('You can only pass items or sections, not both');
  }

  const scrollableSx = {
    overflow: 'auto',
    maxHeight: '100%',
    scrollbarWidth: 'none',
    '&::-webkit-scrollbar': {
      display: 'none',
    },
    '&-ms-overflow-style:': {
      display: 'none',
    },
  };

  const [open, setOpen] = React.useState<Record<string, boolean>>({});

  /**
   * Handle the selection of a sidebar item
   */
  const handleSelect = (id: string) => {
    console.log('selected', id);
    onSelect(id);
  };

  /**
   * Toggle the open state of a sidebar section
   */
  const toggleOpenState = (id: string) => {
    setOpen(prev => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  return (
    <Stack
      direction='column'
      sx={{
        ...scrollable && scrollableSx,
      }}
    >
      {header}
      <List
        size={size ?? 'md'}
        sx={{
          py: 0,
          userSelect: 'none',
          '--ListItem-radius': '8px',
          '--List-gap': '4px',
          '--List-nestedInsetStart': '13px',
        }}
      >
        {/** Sections */}
        {sections?.map(section => (
          <ListItem key={section.id} nested>
            <ListSubheader>
              {section.title}
            </ListSubheader>
            <List
              aria-labelledby='nav-list-browse'
              sx={{
                '& .JoyListItemButton-root': { p: '8px' },
              }}
            >
              {section.items.map(item => (
                <SidebarListItem
                  key={item.id}
                  item={item}
                  openState={open}
                  onToggleOpen={toggleOpenState}
                  selected={selected}
                  onSelect={handleSelect}
                />
              ))}
            </List>
          </ListItem>
        ))}

        {/** Direct mapped items */}
        {items?.map(item => (
          <SidebarListItem
            key={item.id}
            item={item}
            openState={open}
            onToggleOpen={toggleOpenState}
            selected={selected}
            onSelect={handleSelect}
          />
        ))}
      </List>
    </Stack>
  );
};

/**
 * Recursively render the sidebar items
 *
 * TODO - measure perf and check for necessary memoization opportunities
 */
const SidebarListItem: React.FC<SidebarListItemProps> = ({ level = 0, item, openState, onToggleOpen, selected, onSelect }) => {
  const { id } = item;

  const handleClick = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (item.children?.length) {
      // Shouldn't be selectable if it has children
      console.log('toggle', id);
      onToggleOpen(id);
    } else {
      console.log('select', id);
      onSelect(id);
    }
  };

  return (
    <>
      <ListItem
        key={id}
        sx={{
          userSelect: 'none',
        }}
        nested={Boolean(item.children?.length)}
        endAction={Boolean(item.children?.length) && (
          <IconButton
            variant='plain'
            size='sm'
            color='neutral'
            onClick={handleClick}
          >
            <KeyboardArrowDownRoundedIcon
              sx={{ transform: openState[id] ? 'initial' : 'rotate(-90deg)' }}
            />
          </IconButton>
        )}
      >
        <ListItemButton
          // Should not be selectable if it has children
          selected={selected === id}
          onClick={handleClick}
        >
          {item.icon && (
            <ListItemDecorator>
              {typeof item.icon === 'string' ? (
                <Avatar size='sm' src={item.icon} sx={{ borderRadius: 'sm', maxHeight: 20, maxWidth: 20 }} />
              ) : (
                item.icon
              )}
            </ListItemDecorator>
          )}
          <ListItemContent>
            <Typography
              level={item.children?.length ? 'body-sm' : 'inherit'}
            >
              {item.label}
            </Typography>
          </ListItemContent>
        </ListItemButton>
        {Boolean(item.children?.length) && Boolean(openState[id]) && (
          <List
            aria-labelledby={`nav-list-${id}`}
            size='sm'
          >
            {item.children?.map(child => (
              <SidebarListItem
                level={level + 1}
                key={child.id}
                item={child}
                parentID={id}
                openState={openState}
                onToggleOpen={onToggleOpen}
                selected={selected}
                onSelect={onSelect}
              />
            ))}
          </List>
        )}
      </ListItem>
    </>
  );
};

export default NavMenu;
