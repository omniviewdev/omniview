import React from 'react';

// ui
import { Avatar, Chip, IconButton, Text } from '@omniviewdev/base-ui';

// Icons import
import { LuChevronDown } from 'react-icons/lu';

// Custom
import { type SidebarListItemProps, type SidebarProps } from './types';
import { IsImage } from '@/utils/url';
import Icon from '@/components/icons/Icon';
import styles from './NavMenu.module.css';

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
    <div className={styles.Root} data-scrollable={scrollable ? 'true' : undefined}>
      {header}
      <ul className={styles.List} data-size={size ?? 'md'}>
        {/** Sections */}
        {sections?.map(section => (
          <li key={section.id} className={styles.Section}>
            {section.title && (
              <div className={styles.Subheader}>
                {section.title}
              </div>
            )}
            <ul
              aria-labelledby='nav-list-browse'
              className={`${styles.List} ${styles.SectionList}`}
              data-size={size ?? 'md'}
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
            </ul>
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
      </ul>
    </div>
  );
};

NavMenu.displayName = 'NavMenu';
NavMenu.whyDidYouRender = true;

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

  const MemoizedIcon = React.useMemo(() => (
    <LuChevronDown size={16} className={styles.Chevron} data-open={openState[id] ? 'true' : undefined} />
  ), [openState[id]]);

  const hasChildren = Boolean(item.children?.length);

  return (
    <li key={id} className={styles.Item}>
      <div className={styles.Row}>
        <button
          type='button'
          className={styles.ItemButton}
          // Should not be selectable if it has children
          data-selected={selected === id ? 'true' : undefined}
          aria-current={selected === id ? 'page' : undefined}
          onClick={handleClick}
        >
          {item.icon && (
            <span className={styles.Decorator}>
              {typeof item.icon === 'string' ? (
                IsImage(item.icon)
                  ? <Avatar size='sm' shape='rounded' src={item.icon} className={styles.ImageAvatar} />
                  : <Icon name={item.icon} size={16} />
              ) : (
                item.icon
              )}
            </span>
          )}
          <span className={styles.Content}>
            <Text
              weight={hasChildren ? 'semibold' : undefined}
              size={hasChildren ? 'sm' : 'xs'}
            >
              {item.label}
            </Text>
          </span>
        </button>
        {hasChildren ? (
          <span className={styles.EndAction}>
            <IconButton
              variant='ghost'
              size='sm'
              color='neutral'
              aria-label={openState[id] ? 'Collapse' : 'Expand'}
              onClick={handleClick}
            >
              {MemoizedIcon}
            </IconButton>
          </span>
        ) : (
          item.decorator !== undefined && item.decorator !== null && (
            <span className={styles.EndAction}>
              {typeof item.decorator === 'string'
                ? (
                  <Chip size='sm' variant='outline' color='neutral'>
                    <Text size='xs' className={styles.DecoratorText}>{item.decorator}</Text>
                  </Chip>
                ) : item.decorator}
            </span>
          )
        )}
      </div>
      {hasChildren && Boolean(openState[id]) && (
        <ul
          aria-labelledby={`nav-list-${id}`}
          className={`${styles.List} ${styles.Nested}`}
          data-size='sm'
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
        </ul>
      )}
    </li>
  );
};

SidebarListItem.displayName = 'SidebarListItem';
SidebarListItem.whyDidYouRender = true;

export default NavMenu;
