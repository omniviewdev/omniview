import React from 'react';

// Material-ui
import { CssVarsProvider } from '@mui/joy/styles';
import CssBaseline from '@mui/joy/CssBaseline';

// Layout
import Layout from '@/layouts/core/sidenav';

// Components
import SettingsNav from './SettingsNav';
import CoreSettingsPage from './CoreSettingsPage';
import PluginSettingsPage from './PluginSettingsPage';

export enum Section {
  Core = 'core',
  Plugins = 'plugins',
}

export type SectionSelection = {
  /** Section of the settings */
  section: Section;
  /** ID of the part of the seciton (e.g the category or plugin ID) */
  id: string;
};

/**
 * The main settings page for the application.
 */
export default function SettingsPage() {
  const [selected, setSelected] = React.useState<SectionSelection>({ section: Section.Core, id: '' });

  return (
    <CssVarsProvider disableTransitionOnChange>
      <CssBaseline />
      <Layout.Root
        sx={{
          p: 8,
          gap: 8,
        }}
      >
        <Layout.SideNav>
          <SettingsNav selected={selected} onChange={setSelected} />
        </Layout.SideNav>
        <Layout.Main>
          {GetSettingsPage(selected.section, selected.id)}
        </Layout.Main>
      </Layout.Root>
    </CssVarsProvider>
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
      return <CoreSettingsPage id={id} />;
    case Section.Plugins:
      return <PluginSettingsPage id={id} />;
  }
};
