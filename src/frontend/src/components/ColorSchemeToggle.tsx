import { useEffect, useState } from 'react';
import { useColorScheme } from '@mui/joy/styles';
import IconButton, { type IconButtonProps } from '@mui/joy/IconButton';

import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded';
import LightModeIcon from '@mui/icons-material/LightMode';

export default function ColorSchemeToggle({
  onClick,
  sx,
  ...props
}: IconButtonProps) {
  const { mode, setMode } = useColorScheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <IconButton
        size='md'
        variant='outlined'
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
      variant='outlined'
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
