import React from 'react';

import { Avatar, NavList, useTheme } from '@omniviewdev/base-ui';

import Icon from '@/components/icons/Icon';
import { type SectionSelection, Section } from './settingsContext';
import { useScopedSettings, useExtensionPointSnapshot, PLUGIN_SETTINGS_EXTENSION_POINT_ID, type PluginSettingsContribution, type SettingsCategory } from '@omniviewdev/runtime';
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
  const { density } = useTheme();
  const settings = useScopedSettings({ kind: 'host' });
  const { plugins } = usePluginManager();
  const { contributions } = useExtensionPointSnapshot<PluginSettingsContribution>(PLUGIN_SETTINGS_EXTENSION_POINT_ID);

  if (settings.isLoading || plugins.isLoading) {
    return null;
  }

  if (settings.error) {
    return null;
  }

  const sections: NavSection[] = [
    {
      title: 'Core',
      items: [
        ...Object.values(settings.categories).filter((category): category is SettingsCategory => category !== undefined).map(category => ({
          id: encodeKey(Section.Core, category.id),
          label: category.label,
          icon: <Icon name={category.icon} size={16} />,
        })),
        {
          id: encodeKey(Section.Core, 'ai-tools'),
          label: 'AI Tools',
          icon: <Icon name='LuBot' size={16} />,
        },
        {
          id: encodeKey(Section.Core, 'updates'),
          label: 'Updates',
          icon: <Icon name='LuRefreshCw' size={16} />,
        },
      ],
    },
  ];

  if ((plugins.data?.length ?? 0) > 0 || contributions.length > 0) {
    sections.push({
      title: 'Plugins',
      items: (plugins.data ?? []).map(plugin => ({
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
      })).concat(contributions.filter(contribution => contribution.value?.contractVersion === 1 &&
        !plugins.data?.some(plugin => plugin.id === contribution.plugin)).map(contribution => ({
        id: encodeKey(Section.Plugins, contribution.plugin),
        label: contribution.value.label,
        icon: <Icon name="LuSettings" size={16} />,
      }))),
    });
  }

  const selectedKey = encodeKey(selected.section, selected.id);

  return (
    <NavList
      size='sm'
      density={density}
      selectionMode='single'
      selectedKeys={new Set([selectedKey])}
      onSelectedKeysChange={(keys) => {
        const [key] = Array.from(keys);
        if (typeof key === 'string') {
          onChange(decodeKey(key));
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
