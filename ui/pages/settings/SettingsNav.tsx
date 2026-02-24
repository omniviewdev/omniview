import React from 'react';

import { NavMenu, type NavSection } from '@omniviewdev/ui/sidebars';
import { Avatar } from '@omniviewdev/ui';

import Icon from '@/components/icons/Icon';
import { type SectionSelection, Section } from '.';
import { useSettingsProvider } from '@/hooks/settings/useCoreSettings';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import { IsImage } from '@/utils/url';

type Props = {
  selected: SectionSelection;
  onChange: (selection: { section: Section; id: string }) => void;
};

/** Encode section + id into a single NavMenu selection key */
const encodeKey = (section: Section, id: string) => `${section}:${id}`;

/** Decode a NavMenu selection key back into section + id */
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
            size='sm'
            src={plugin.metadata.icon}
            sx={{
              borderRadius: '4px',
              backgroundColor: 'transparent',
              objectFit: 'contain',
              border: 0,
              width: 16,
              height: 16,
            }}
          />
        ) : <Icon name={plugin.metadata.icon} size={16} />,
      })),
    });
  }

  return (
    <NavMenu
      size='sm'
      sections={sections}
      selected={encodeKey(selected.section, selected.id)}
      onSelect={(key) => onChange(decodeKey(key))}
      sx={{ py: 1 }}
    />
  );
};

export default SettingsNav;
