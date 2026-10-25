import React from 'react';

import { Avatar, NavList } from '@omniviewdev/base-ui';

import Icon from '@/components/icons/Icon';
import { type SectionSelection, Section } from './settingsContext';
import { useSettingsProvider } from '@/hooks/settings/useCoreSettings';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import { IsImage } from '@/utils/url';
import styles from './SettingsNav.module.css';

type NavItem = {
  id: string;
  label: string;
  icon: React.ReactNode;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

type Props = {
  selected: SectionSelection;
  onChange: (selection: { section: Section; id: string }) => void;
};

/** Encode section + id into a single NavList selection key */
const encodeKey = (section: Section, id: string) => `${section}:${id}`;

/** Decode a NavList selection key back into section + id */
const decodeKey = (key: string): { section: Section; id: string } => {
  const idx = key.indexOf(':');
  return {
    section: key.slice(0, idx) as Section,
    id: key.slice(idx + 1),
  };
};

const SettingsNav: React.FC<Props> = ({ selected, onChange }) => {
  const { settings } = useSettingsProvider();
  const { plugins } = usePluginManager();

  if (settings.isLoading || plugins.isLoading) {
    return null;
  }

  if (settings.isError || !settings.data) {
    return null;
  }

  const sections: NavSection[] = [
    {
      title: 'Core',
      items: [
        ...Object.values(settings.data).map(category => ({
          id: encodeKey(Section.Core, category.id),
          label: category.label,
          icon: <Icon name={category.icon} size={16} />,
        })),
        {
          id: encodeKey(Section.Core, 'extensions'),
          label: 'Extensions',
          icon: <Icon name='LuBrainCircuit' size={16} />,
        },
      ],
    },
  ];

  if (plugins.data?.length) {
    sections.push({
      title: 'Plugins',
      items: plugins.data.map(plugin => ({
        id: encodeKey(Section.Plugins, plugin.id),
        label: plugin.metadata.name,
        icon: IsImage(plugin.metadata?.icon) ? (
          <Avatar
            size='xs'
            shape='rounded'
            src={plugin.metadata.icon}
            alt={plugin.metadata.name}
            className={styles.PluginAvatar}
          />
        ) : <Icon name={plugin.metadata.icon} size={16} />,
      })),
    });
  }

  const selectedKey = encodeKey(selected.section, selected.id);

  return (
    <NavList
      size='sm'
      selectionMode='single'
      selectedKeys={new Set([selectedKey])}
      onSelectedKeysChange={(keys) => {
        const [key] = Array.from(keys);
        if (key !== undefined) {
          onChange(decodeKey(String(key)));
        }
      }}
      className={styles.Root}
    >
      <NavList.Viewport>
        {sections.map(section => (
          <NavList.Group key={section.title}>
            <NavList.GroupHeader>{section.title}</NavList.GroupHeader>
            <NavList.GroupItems>
              {section.items.map(item => (
                <NavList.Item key={item.id} itemKey={item.id} textValue={item.label}>
                  <NavList.ItemIcon>{item.icon}</NavList.ItemIcon>
                  <NavList.ItemLabel>{item.label}</NavList.ItemLabel>
                </NavList.Item>
              ))}
            </NavList.GroupItems>
          </NavList.Group>
        ))}
      </NavList.Viewport>
    </NavList>
  );
};

export default SettingsNav;
