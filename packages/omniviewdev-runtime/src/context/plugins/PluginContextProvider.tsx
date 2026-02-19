import React from 'react';

import { PluginContext } from './PluginContext';
import { PluginValues } from '../../wailsjs/go/settings/Client';
import { config } from '../../wailsjs/go/models';
import { GetPluginMeta } from '../../wailsjs/go/plugin/pluginManager';

export type PluginContextProviderProps = {
  pluginId: string;
};

export function PluginContextProvider(props: React.PropsWithChildren<PluginContextProviderProps>): React.ReactElement {
  const { children, pluginId } = props;
  const [settings, setSettings] = React.useState<Record<string, any>>({});
  const [meta, setMeta] = React.useState<config.PluginMeta>(new config.PluginMeta);
  const [metaLoaded, setMetaLoaded] = React.useState(false);
  const [metaError, setMetaError] = React.useState<string | null>(null);

  console.debug(`[PluginContextProvider] render`, { pluginId, metaLoaded, metaError: !!metaError });

  /**
   * Fetch the settings from the backend stores
   */
  const fetchSettings = () => {
    if (pluginId === undefined || pluginId === '') {
      return
    }

    console.debug(`[PluginContextProvider] fetching settings for "${pluginId}"`);
    PluginValues(pluginId)
      .then((values) => {
        console.debug(`[PluginContextProvider] settings loaded for "${pluginId}"`, Object.keys(values));
        setSettings(values)
      })
      .catch((error) => {
        console.error(`[PluginContextProvider] error fetching settings for "${pluginId}":`, error);
      })
  }

  /**
   * Fetch the metadata for the plugin from the backend stores
   */
  const fetchMeta = () => {
    if (pluginId === undefined || pluginId === '') {
      console.debug(`[PluginContextProvider] skipping meta fetch — empty pluginId`);
      return
    }

    console.debug(`[PluginContextProvider] fetching meta for "${pluginId}"`);
    setMetaError(null);

    GetPluginMeta(pluginId)
      .then((values) => {
        console.debug(`[PluginContextProvider] meta loaded for "${pluginId}"`, { name: values?.name, version: values?.version });
        setMeta(values)
        setMetaLoaded(true)
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[PluginContextProvider] error fetching meta for "${pluginId}":`, message);
        setMetaError(message);
        setMetaLoaded(false)
      })
  }

  React.useEffect(() => {
    console.debug(`[PluginContextProvider] useEffect — pluginId changed to "${pluginId}"`);
    fetchSettings();
    fetchMeta();
  }, [pluginId])

  if (metaError) {
    return (
      <div style={{
        display: 'flex',
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}>
        <div style={{
          maxWidth: 480,
          width: '100%',
          border: '1px solid #7F1D1D',
          borderRadius: 8,
          backgroundColor: '#1C1917',
          padding: 20,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#FECACA' }}>
              Plugin failed to load
            </span>
          </div>
          <p style={{ fontSize: 13, color: '#A1A1AA', margin: '0 0 16px' }}>
            {metaError}
          </p>
          <button
            onClick={() => fetchMeta()}
            style={{
              background: 'transparent',
              color: '#F87171',
              border: '1px solid #7F1D1D',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!metaLoaded) {
    return (
      <div style={{
        display: 'flex',
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{
          width: 24,
          height: 24,
          border: '2px solid #3F3F46',
          borderTopColor: '#A1A1AA',
          borderRadius: '50%',
          animation: 'plugin-spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes plugin-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return <PluginContext.Provider value={{ settings, meta }}>{children}</PluginContext.Provider>;
}
