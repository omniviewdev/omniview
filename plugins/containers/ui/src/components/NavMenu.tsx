import React from 'react';

// UI
import { Chip, NavList, Stack } from '@omniviewdev/base-ui';

// Custom
import { type SidebarListItemProps, type SidebarProps } from './types';
import styles from './NavMenu.module.css';

/**
 * Render a navigation menu in a sidebar layout
 */
const NavMenu: React.FC<SidebarProps> = ({ header, size, items, sections, selected, onSelect }) => {
  if (items == null && sections == null) {
    throw new Error('You must pass either items or sections');
  }

  if (Boolean(items?.length) && Boolean(sections?.length)) {
    throw new Error('You can only pass items or sections, not both');
  }

  const [open, setOpen] = React.useState<Record<string, boolean>>({});

  const selectedKeys = React.useMemo(
    () => new Set<string>(selected ? [selected] : []),
    [selected],
  );

  /**
   * Handle the selection of a sidebar item
   */
  const handleSelectedKeysChange = (keys: ReadonlySet<string | number>) => {
    const [first] = Array.from(keys);
    if (first != null) {
      onSelect(String(first));
    }
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
    <Stack direction='column' spacing={2} className={styles.Scrollable}>
      {header}
      <NavList
        className={styles.List}
        size={size ?? 'md'}
        density={size === 'sm' ? 'compact' : 'default'}
        selectionMode='single'
        selectedKeys={selectedKeys}
        onSelectedKeysChange={handleSelectedKeysChange}
      >
        {/** Sections */}
        {sections?.map(section => (
          <NavList.Group key={section.id}>
            {section.title && (
              <NavList.GroupHeader>{section.title}</NavList.GroupHeader>
            )}
            <div className={styles.SectionItems} aria-labelledby='nav-list-browse'>
              {section.items.map(item => (
                <SidebarListItem
                  key={item.id}
                  item={item}
                  openState={open}
                  onToggleOpen={toggleOpenState}
                  selected={selected}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </NavList.Group>
        ))}

        {/** Direct mapped items */}
        {items?.map(item => (
          <SidebarListItem
            key={item.id}
            item={item}
            openState={open}
            onToggleOpen={toggleOpenState}
            selected={selected}
            onSelect={onSelect}
          />
        ))}
      </NavList>
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

  if (item.children?.length) {
    return (
      <NavList.Group
        collapsible
        expanded={Boolean(openState[id])}
        onExpandedChange={() => onToggleOpen(id)}
      >
        <NavList.GroupHeader>{item.label}</NavList.GroupHeader>
        <NavList.GroupItems aria-labelledby={`nav-list-${id}`}>
          {item.children.map(child => (
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
        </NavList.GroupItems>
      </NavList.Group>
    );
  }

  return (
    <NavList.Item itemKey={id} textValue={item.label}>
      <NavList.ItemLabel>{item.label}</NavList.ItemLabel>
      {item.decorator != null && (
        <NavList.ItemMeta>
          {typeof item.decorator === 'string'
            ? (
              <Chip size='xs' variant='outline' className={styles.DecoratorChip}>
                {item.decorator}
              </Chip>
            ) : item.decorator}
        </NavList.ItemMeta>
      )}
    </NavList.Item>
  );
};

SidebarListItem.displayName = 'SidebarListItem';

export default NavMenu;
