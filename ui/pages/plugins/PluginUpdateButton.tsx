import * as React from 'react';
import Box from '@mui/material/Box';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import { Button, IconButton } from '@omniviewdev/ui/buttons';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import { usePlugin } from '@/hooks/plugin/usePluginManager';

type Props = {
  pluginID: string;
  currentVersion?: string;
  installed?: boolean;
};

export default function PluginUpdateButton({ pluginID, currentVersion, installed }: Props) {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const anchorRef = React.useRef<HTMLDivElement>(null);

  const { versions, update } = usePlugin({ id: pluginID });

  const handleMenuItemClick = (version: string) => {
    setAnchorEl(null);
    update(version);
  };

  if (!versions.data?.Versions) {
    return null;
  }

  const isLatest = installed && currentVersion === versions.data.Latest;

  // Show versions newest-first without mutating the original array
  const sortedVersions = [...versions.data.Versions].reverse();

  return (
    <Box ref={anchorRef} sx={{ display: 'flex', gap: '1px' }}>
      <Button
        emphasis="soft"
        color="primary"
        disabled={isLatest}
        onClick={() => update(versions.data!.Latest)}
        sx={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
      >
        {!installed ? 'Install' : isLatest ? 'Updated' : 'Update'}
      </Button>
      <IconButton
        emphasis="soft"
        color="primary"
        aria-label="Select version"
        aria-haspopup="menu"
        onClick={() => setAnchorEl(anchorRef.current)}
        sx={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
      >
        <ArrowDropDownIcon sx={{ fontSize: 18 }} />
      </IconButton>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              maxHeight: 280,
              minWidth: 180,
              bgcolor: 'var(--ov-bg-elevated, #1c2128)',
              border: '1px solid var(--ov-border-default, #30363d)',
              color: 'var(--ov-fg-default, #c9d1d9)',
            },
          },
        }}
      >
        {sortedVersions.map((version) => (
          <MenuItem
            key={version}
            selected={version === currentVersion}
            onClick={() => handleMenuItemClick(version)}
            sx={{
              fontSize: '0.8125rem',
              fontFamily: 'var(--ov-font-mono, monospace)',
              py: 0.75,
              '&.Mui-selected': {
                bgcolor: 'var(--ov-accent-subtle, rgba(56,139,253,0.15))',
                '&:hover': { bgcolor: 'var(--ov-accent-subtle, rgba(56,139,253,0.2))' },
              },
            }}
          >
            <Typography component="span" sx={{ fontSize: '0.8125rem', fontFamily: 'inherit' }}>
              {version}
            </Typography>
            {version === currentVersion && (
              <Typography
                component="span"
                sx={{
                  ml: 1,
                  fontSize: '0.6875rem',
                  color: 'var(--ov-fg-faint)',
                }}
              >
                (current)
              </Typography>
            )}
          </MenuItem>
        ))}
      </Menu>
    </Box>
  );
}
