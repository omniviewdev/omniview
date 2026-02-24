import { useEffect, useState } from 'react';
import { useColorScheme } from '@mui/material/styles';
import { IconButton } from '@omniviewdev/ui/buttons';

import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded';
import LightModeIcon from '@mui/icons-material/LightMode';

export default function ColorSchemeToggle({
  onClick,
  sx,
  ...props
}: any) {
  const { mode, setMode } = useColorScheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <IconButton
        size='md'
        emphasis='outline'
        color='neutral'
        {...props}
        sx={sx}
        disabled
      />
    );
  }

  return (
    <IconButton
      id='toggle-mode'
      size='md'
      emphasis='outline'
      color='neutral'
      {...props}
      onClick={event => {
        if (mode === 'light') {
          setMode('dark');
        } else {
          setMode('light');
        }

        onClick?.(event);
      }}
      sx={[
        {
          '& > *:first-of-type': {
            display: mode === 'dark' ? 'none' : 'initial',
          },
          '& > *:last-child': {
            display: mode === 'light' ? 'none' : 'initial',
          },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <DarkModeRoundedIcon />
      <LightModeIcon />
    </IconButton>
  );
}
