import React from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useSettingsProvider } from '@/hooks/settings/useCoreSettings';
import { usePluginManager } from '@/hooks/plugin/usePluginManager';

// Layout
import Layout from '@/layouts/core/sidenav';

// Components
import SettingsNav from './SettingsNav';
import CoreSettingsPage from './CoreSettingsPage';
import PluginSettingsPage from './PluginSettingsPage';
import ExtensionSettingsPage from './ExtensionSettingsPage';

export enum Section {
  Core = 'core',
  Plugins = 'plugins',
  Extensions = 'extensions',
}

const SECTION_BY_QUERY: Record<string, Section> = {
  core: Section.Core,
  plugins: Section.Plugins,
  extensions: Section.Extensions,
};

export type SectionSelection = {
  /** Section of the settings */
  section: Section;
  /** ID of the part of the seciton (e.g the category or plugin ID) */
  id: string;
};

type SettingsFocusRequest = {
  settingId: string;
  requestKey: string;
};
export const SettingsFocusContext = React.createContext<SettingsFocusRequest | null>(null);

/**
 * The main settings page for the application.
 */
export default function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const { settings } = useSettingsProvider();
  const { plugins } = usePluginManager();
  const sectionQuery = searchParams.get('section') ?? 'core';
  const section = Object.hasOwn(SECTION_BY_QUERY, sectionQuery) ? SECTION_BY_QUERY[sectionQuery] : undefined;
  const id = section === Section.Extensions ? 'extensions'
    : section === Section.Plugins ? searchParams.get('plugin') ?? '' : searchParams.get('category') ?? '';
  const focusTarget = searchParams.get('setting');
  const focusRequest = React.useMemo(() => focusTarget === null ? null : { settingId: focusTarget, requestKey: location.key }, [focusTarget, location.key]);
  const validSection = section !== undefined;
  const malformed = !validSection || id.length > 256
    || (focusTarget !== null && (!focusTarget || focusTarget.length > 256 || !id || section === Section.Extensions));
  const selected: SectionSelection = { section: section ?? Section.Core, id };
  const loading = section === Section.Core ? settings.isLoading : section === Section.Plugins ? plugins.isLoading : false;
  const missing = Boolean(id) && (section === Section.Core && id !== 'extensions'
    ? !settings.data || !Object.values(settings.data).some((category) => category.id === id)
    : section === Section.Plugins ? !plugins.data?.some((plugin) => plugin.id === id) : false);
  const unavailable = malformed || (!loading && missing) || (section === Section.Plugins && !id);
  const navSelection = section === Section.Extensions ? { section: Section.Core, id: 'extensions' } : selected;

  function select(next: SectionSelection) {
    const params = new URLSearchParams();
    if (next.section === Section.Extensions || (next.section === Section.Core && next.id === 'extensions')) {
      params.set('section', Section.Extensions);
    } else {
      params.set('section', next.section);
      params.set(next.section === Section.Plugins ? 'plugin' : 'category', next.id);
    }

    setSearchParams(params);
  }

  return (
    <Layout.Root>
      <Layout.SideNav type='bordered'>
        <SettingsNav selected={navSelection} onChange={select} />
      </Layout.SideNav>
      <Layout.Main style={{ padding: 24, paddingLeft: 32 }}>
        <SettingsFocusContext.Provider value={focusRequest}>
          {unavailable ? <p role='status'>Requested settings are unavailable.</p>
            : loading ? <p role='status'>Loading settings…</p>
              : GetSettingsPage(selected.section, selected.id)}
        </SettingsFocusContext.Provider>
      </Layout.Main>
    </Layout.Root>
  );
}

const GetSettingsPage = (section: Section, id: string) => {
  if (!id) {
    return (
      <></>
    );
  }

  switch (section) {
    case Section.Core:
      switch (id) {
        case 'extensions':
          return <ExtensionSettingsPage />;
        default:
          return <CoreSettingsPage key={`core:${id}`} id={id} />;
      }

    case Section.Plugins:
      return <PluginSettingsPage key={`plugins:${id}`} id={id} />;
    case Section.Extensions:
      return <ExtensionSettingsPage />;
  }
};
