
import React from 'react';

// Material-ui
import {
  Avatar,
  Chip,
  IconButton,
  List,
  ListSubheader,
  ListItem,
  ListItemButton,
  ListItemDecorator,
  ListItemContent,
  Stack,
  Typography,
} from '@mui/joy';

// Icons import
import { KeyboardArrowDownRounded } from '@mui/icons-material';

// Custom
import { SidebarItem, SidebarSection, type SidebarListItemProps, type SidebarProps } from './types';
import { IsImage } from '../../../utils/url';
import Icon from '../Icon';
import { useParams } from 'react-router-dom';
import { usePluginRouter } from '@omniviewdev/runtime';


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

const getInitialOpenState = (items: SidebarItem[] | undefined, sections: SidebarSection[] | undefined) => {
  const state: Record<string, boolean> = {}

  items?.forEach((item) => {
    if (item.defaultExpanded) {
      state[item.id] = true
    }
  })

  sections?.forEach((section) => {

    section.items?.forEach((item) => {
      if (item.defaultExpanded) {
        state[item.id] = true
      }
    })
  })

  console.log("got open state: ", state)

  return state
}

/**
 * Render a navigation menu in a sidebar layout
 */
const NavMenu: React.FC<SidebarProps> = ({ header, size, items, sections }) => {
  const { id } = useParams<{ id: string }>()
  const { location, navigate } = usePluginRouter();

  const selected = location.pathname.split('/').pop();

  const onSelect = React.useCallback((resourceID: string) => {
    navigate(`/cluster/${id}/resources/${resourceID}`);
  }, [navigate])

  if (items == null && sections == null) {
    throw new Error('You must pass either items or sections');
  }

  if (Boolean(items?.length) && Boolean(sections?.length)) {
    throw new Error('You can only pass items or sections, not both');
  }


  // memoize the scrollable styles to prevent rerenders
  const scrollStyle = React.useMemo(() => scrollableSx, []);

  const [open, setOpen] = React.useState<Record<string, boolean>>({});

  React.useLayoutEffect(() => {
    const initialOpen = getInitialOpenState(items, sections)
    setOpen(initialOpen)
  }, [items, sections])

  /**
   * Handle the selection of a sidebar item
   */
  const handleSelect = React.useCallback((id: string) => {
    onSelect(id);
  }, [onSelect])

  /**
   * Toggle the open state of a sidebar section
   */
  const toggleOpenState = React.useCallback((id: string) => {
    setOpen(prev => ({
      ...prev,
      [id]: !prev[id],
    }));
  }, [setOpen])

  return (
    <Stack
      direction='column'
      sx={scrollStyle}
    >
      {header}
      <List
        size={size ?? 'md'}
        sx={{
          py: 0,
          userSelect: 'none',
          '--ListItem-radius': '8px',
          '--List-nestedInsetStart': '0px',
        }}
      >
        {/** Sections */}
        {sections?.map(section => (
          <ListItem key={section.id} nested>
            {section.title && (
              <ListSubheader sx={{ minBlockSize: 0, pt: 1.5 }}>
                {section.title}
              </ListSubheader>
            )}
            <List
              aria-labelledby='nav-list-browse'
              size={size ?? 'md'}
              sx={{
                py: 0,
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
// NavMenu.whyDidYouRender = true;



/**
 * Recursively render the sidebar items
 *
 * TODO - measure perf and check for necessary memoization opportunities
 */
const SidebarListItem: React.FC<SidebarListItemProps> = ({ level = 0, item, openState, onToggleOpen, selected, onSelect }) => {
  const { id } = item;
  const height = level === 0 ? 28 : 24

  const handleClick = React.useCallback((e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (item.children?.length) {
      // Shouldn't be selectable if it has children
      onToggleOpen(id);
    } else {
      onSelect(id);
    }
  }, [onToggleOpen, onSelect, item.children])

  const MemoizedIcon = React.useMemo(() => (
    <KeyboardArrowDownRounded sx={{ transform: openState[id] ? 'initial' : 'rotate(-90deg)' }} />
  ), [openState, id]);

  return (
    <ListItem
      key={id}
      sx={{
        userSelect: 'none',
        paddingY: 0,
        paddingInlineStart: !!item.icon ? undefined : '2rem',
      }}
      nested={Boolean(item.children?.length)}
      endAction={item.children?.length ? (
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
        sx={{
          marginY: 0,
          paddingY: 0,
          maxHeight: height,
        }}
      >
        {item.icon && (
          <ListItemDecorator
            sx={{
              marginInlineEnd: '-1rem',
            }}
          >
            {typeof item.icon === 'string' ? (
              IsImage(item.icon)
                ? <Avatar size='sm' src={item.icon} sx={{ borderRadius: 'sm', maxHeight: 20, maxWidth: 20 }} />
                : <Icon name={item.icon} size={16} />
            ) : (
              item.icon
            )}
          </ListItemDecorator>
        )}
        <ListItemContent>
          <Typography
            level={level == 0 || item.children?.length ? 'title-sm' : 'body-xs'}
            fontWeight={selected == id ? 600 : 500}
          >
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
            '--ListItem-minHeight': `${height}px`,
            '--List-gap': '0px',
            '--ListItem-paddingLeft': '1rem',
            paddingTop: 0.5,
            paddingBottom: 0,
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
  );
};

SidebarListItem.displayName = 'SidebarListItem';
// SidebarListItem.whyDidYouRender = true;

export default NavMenu;
