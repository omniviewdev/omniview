import React from 'react';

import Box from '@mui/material/Box';
import { LuPuzzle } from 'react-icons/lu';

import { usePluginManager } from '@/hooks/plugin/usePluginManager';

const InstalledPlugins: React.FC = () => {
  const { plugins, available } = usePluginManager();

  const installedCount = plugins.data?.length ?? 0;
  const availableCount = (available.data as any[])?.length ?? 0;

  return (
    <Box sx={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      px: 4,
      color: 'var(--ov-fg-faint, #8b949e)',
    }}>
      <LuPuzzle size={40} style={{ opacity: 0.3 }} />
      <Box sx={{
        fontSize: '0.875rem',
        textAlign: 'center',
        maxWidth: 280,
        lineHeight: 1.6,
      }}>
        Select a plugin to view details, or browse the Marketplace.
      </Box>

      {/* Quick stats */}
      {(installedCount > 0 || availableCount > 0) && (
        <Box sx={{
          display: 'flex',
          gap: 3,
          mt: 1,
          fontSize: '0.75rem',
        }}>
          {installedCount > 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
              <Box sx={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--ov-fg-default, #c9d1d9)' }}>
                {installedCount}
              </Box>
              <span>Installed</span>
            </Box>
          )}
          {availableCount > 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
              <Box sx={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--ov-fg-default, #c9d1d9)' }}>
                {availableCount}
              </Box>
              <span>Available</span>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

export default InstalledPlugins;
