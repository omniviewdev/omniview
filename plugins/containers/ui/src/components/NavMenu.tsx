import React from 'react';

// UI
import { IconButton } from '@omniviewdev/ui/buttons';
import { Chip } from '@omniviewdev/ui';
import { Text } from '@omniviewdev/ui/typography';
import { Stack } from '@omniviewdev/ui/layout';
import List from '@mui/material/List';
import ListSubheader from '@mui/material/ListSubheader';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';

// Icons import
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';

// Custom
import { type SidebarListItemProps, type SidebarProps } from './types';
// import { IsImage } from '@/utils/url';
// import Icon from '@/components/icons/Icon';

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

  // memoize the scrollable styles to prevent rerenders
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

  // memoize the scrollable styles to prevent rerenders
  const scrollStyle = React.useMemo(() => scrollableSx, [scrollable]);

  const [open, setOpen] = React.useState<Record<string, boolean>>({});

  /**
   * Handle the selection of a sidebar item
   */
  const handleSelect = (id: string) => {
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
      sx={scrollStyle}
    >
      {header}
      <List
        dense={size === 'sm'}
        sx={{
          userSelect: 'none',
          p: '4px',
        }}
      >
        {/** Sections */}
        {sections?.map(section => (
          <li key={section.id}>
            {section.title && (
              <ListSubheader
                sx={{ bgcolor: 'background.paper' }}
              >
                {section.title}
              </ListSubheader>
            )}
            <List
              aria-labelledby='nav-list-browse'
              dense={size === 'sm'}
              sx={{
                py: 1,
                pl: '13px',
                '& .MuiListItemButton-root': { p: '8px' },
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
          </li>
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

NavMenu.displayName = 'NavMenu';

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
      onToggleOpen(id);
    } else {
      onSelect(id);
    }
  };

  const MemoizedIcon = React.useMemo(() => (
    <KeyboardArrowDownRoundedIcon sx={{ transform: openState[id] ? 'initial' : 'rotate(-90deg)' }} />
  ), [openState[id]]);

  return (
    <>
      <ListItem
        key={id}
        sx={{
          userSelect: 'none',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
        }}
        disablePadding
        secondaryAction={Boolean(item.children?.length) ? (
          <IconButton
            emphasis='ghost'
            size='sm'
            onClick={handleClick}
          >
            {MemoizedIcon}
          </IconButton>
        ) : (
          typeof item.decorator === 'string'
            ? (
              <Chip size='sm' emphasis='outline' sx={{ borderRadius: 1 }}>
                <Text size="xs" style={{ fontSize: 10 }}>{item.decorator}</Text>
              </Chip>
            ) : item.decorator
        )}
      >
        <ListItemButton
          selected={selected === id}
          onClick={handleClick}
          sx={{ borderRadius: '8px' }}
        >
          <ListItemText
            primary={
              <Text size="sm">
                {item.label}
              </Text>
            }
          />
        </ListItemButton>
        {Boolean(item.children?.length) && Boolean(openState[id]) && (
          <List
            aria-labelledby={`nav-list-${id}`}
            dense
            sx={{
              borderRadius: '8px',
            }}
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

SidebarListItem.displayName = 'SidebarListItem';

export default NavMenu;
