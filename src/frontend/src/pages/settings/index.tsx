import React from 'react';

// material-ui
import { CssVarsProvider } from '@mui/joy/styles';
import CssBaseline from '@mui/joy/CssBaseline';

// layout
import Layout from '@/layouts/core/sidenav';

// components
import SettingsNav from './SettingsNav';
import SettingsSection from './SettingsSection';

export type NamespaceSection = {
  /** The namespace ID of a section of settings */
  namespaceID: string;

  /** The section ID of a section of settings */
  sectionID: string;
}

/**
 * The main settings page for the application.
 */
export default function SettingsPage() {
  const [selected, setSelected] = React.useState<NamespaceSection>({ namespaceID: 'core', sectionID: 'appearance' })

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
          <SettingsSection namespaceID={selected.namespaceID} sectionID={selected.sectionID} />
        </Layout.Main>
      </Layout.Root>
    </CssVarsProvider>
  );
}
