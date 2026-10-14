import React from 'react';

import { LuPuzzle } from 'react-icons/lu';

import { usePluginManager } from '@/hooks/plugin/usePluginManager';
import styles from './InstalledPlugins.module.css';

const InstalledPlugins: React.FC = () => {
  const { plugins, available } = usePluginManager();

  const installedCount = plugins.data?.length ?? 0;
  const availableCount = (available.data as any[])?.length ?? 0;

  return (
    <div className={styles.Root}>
      <LuPuzzle size={40} style={{ opacity: 0.3 }} />
      <div className={styles.Message}>
        Select a plugin to view details, or browse the Marketplace.
      </div>

      {/* Quick stats */}
      {(installedCount > 0 || availableCount > 0) && (
        <div className={styles.Stats}>
          {installedCount > 0 && (
            <div className={styles.Stat}>
              <div className={styles.StatValue}>
                {installedCount}
              </div>
              <span>Installed</span>
            </div>
          )}
          {availableCount > 0 && (
            <div className={styles.Stat}>
              <div className={styles.StatValue}>
                {availableCount}
              </div>
              <span>Available</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default InstalledPlugins;
