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
import { Section, SettingsFocusContext, type SectionSelection } from './settingsContext';

const SECTION_BY_QUERY: Record<string, Section> = {
  core: Section.Core,
  plugins: Section.Plugins,
  extensions: Section.Extensions,
};

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
  const selectionParameter = section === Section.Plugins ? 'plugin' : 'category';
  const id = section === Section.Extensions ? 'extensions' : (searchParams.get(selectionParameter) ?? '');
  const focusTarget = searchParams.get('setting');
  const focusRequest = React.useMemo(
    () => (focusTarget === null ? null : { settingId: focusTarget, requestKey: location.key }),
    [focusTarget, location.key],
  );
  const validSection = section !== undefined;
  const malformed =
    !validSection ||
    id.length > 256 ||
    (focusTarget !== null && (!focusTarget || focusTarget.length > 256 || !id || section === Section.Extensions));
  const selected: SectionSelection = { section: section ?? Section.Core, id };
  const loading =
    (section === Section.Core && settings.isLoading) || (section === Section.Plugins && plugins.isLoading);
  const missing =
    Boolean(id) &&
    ((section === Section.Core &&
      id !== 'extensions' &&
      (!settings.data || !Object.values(settings.data).some((category) => category.id === id))) ||
      (section === Section.Plugins && !plugins.data?.some((plugin) => plugin.id === id)));
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

  let content: React.ReactNode;
  if (unavailable) {
    content = <p role='status'>Requested settings are unavailable.</p>;
  } else if (loading) {
    content = <p role='status'>Loading settings…</p>;
  } else {
    content = GetSettingsPage(selected.section, selected.id);
  }

  return (
    <Layout.Root>
      <Layout.SideNav type='bordered'>
        <SettingsNav selected={navSelection} onChange={select} />
      </Layout.SideNav>
      <Layout.Main style={{ padding: 24, paddingLeft: 32 }}>
        <SettingsFocusContext.Provider value={focusRequest}>{content}</SettingsFocusContext.Provider>
      </Layout.Main>
    </Layout.Root>
  );
}

const GetSettingsPage = (section: Section, id: string) => {
  if (!id) {
    return <></>;
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
