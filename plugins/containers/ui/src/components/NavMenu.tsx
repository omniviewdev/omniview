import React from 'react';

// Material-ui
import {
  // Avatar,
  IconButton,
  List,
  ListSubheader,
  ListItem,
  ListItemButton,
  ListItemContent,
  // ListItemDecorator,
  Stack
} from '@mui/joy';

// Icons import
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';

// Custom
import { type SidebarListItemProps, type SidebarProps } from './types';
import { Chip, Typography } from '@mui/joy';
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
        size={size ?? 'md'}
        sx={{
          userSelect: 'none',
          '--List-padding': '4px',
          '--List-gap': '6px',
          '--ListItem-radius': '8px',
          '--List-nestedInsetStart': '0px',
        }}
      >
        {/** Sections */}
        {sections?.map(section => (
          <ListItem key={section.id} nested>
            {section.title && (
              <ListSubheader
                variant='outlined'
                sx={{ bgcolor: 'background.surface' }}
              >
                {section.title}
              </ListSubheader>
            )}
            <List
              aria-labelledby='nav-list-browse'
              size={size ?? 'md'}
              sx={{
                py: 1,
                '--List-gap': '0px',
                '--List-nestedInsetStart': '13px',
                '--ListItem-paddingLeft': '8px',
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
        }}
        nested={Boolean(item.children?.length)}
        endAction={Boolean(item.children?.length) ? (
          <IconButton
            variant='plain'
            size='sm'
            color='neutral'
            onClick={handleClick}
          >
            {MemoizedIcon}
          </IconButton>
        ) : (
          typeof item.decorator === 'string'
            ? (
              <Chip size='sm' variant='outlined' color='neutral' sx={{ borderRadius: 'sm' }}>
                <Typography level='body-xs' fontSize={10}>{item.decorator}</Typography>
              </Chip>
            ) : item.decorator
        )}
      >
        <ListItemButton
          // Should not be selectable if it has children
          selected={selected === id}
          onClick={handleClick}
        >
          {/* {item.icon && ( */}
          {/*   <ListItemDecorator> */}
          {/*     {typeof item.icon === 'string' ? ( */}
          {/*       IsImage(item.icon) */}
          {/*         ? <Avatar size='sm' src={item.icon} sx={{ borderRadius: 'sm', maxHeight: 20, maxWidth: 20 }} /> */}
          {/*         : <Icon name={item.icon} size={16} /> */}
          {/*     ) : ( */}
          {/*       item.icon */}
          {/*     )} */}
          {/*   </ListItemDecorator> */}
          {/* )} */}
          <ListItemContent>
            <Typography level={'body-sm'}>
              {item.label}
            </Typography>
          </ListItemContent>
        </ListItemButton>
        {Boolean(item.children?.length) && Boolean(openState[id]) && (
          <List
            aria-labelledby={`nav-list-${id}`}
            size='sm'
            sx={{
              '--ListItem-radius': '8px',
              '--List-gap': '0px',
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
