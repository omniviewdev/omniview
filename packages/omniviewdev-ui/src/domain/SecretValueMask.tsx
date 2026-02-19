import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiIconButton from '@mui/material/IconButton';
import { LuEye, LuEyeOff } from 'react-icons/lu';
import { CopyButton } from '../buttons';

export interface SecretValueMaskProps {
  value: string;
  revealed?: boolean;
  onReveal?: () => void;
  copyable?: boolean;
}

export default function SecretValueMask({
  value,
  revealed: controlledRevealed,
  onReveal,
  copyable = false,
}: SecretValueMaskProps) {
  const [internalRevealed, setInternalRevealed] = useState(false);
  const isRevealed = controlledRevealed ?? internalRevealed;

  const handleToggle = () => {
    if (onReveal) {
      onReveal();
    } else {
      setInternalRevealed((prev) => !prev);
    }
  };

  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
      <Typography
        variant="body2"
        sx={{
          fontFamily: 'var(--ov-font-mono)',
          fontSize: '0.8125rem',
          color: isRevealed ? 'var(--ov-fg-base)' : 'var(--ov-fg-muted)',
          letterSpacing: isRevealed ? undefined : '0.15em',
        }}
      >
        {isRevealed ? value : '••••••••'}
      </Typography>
      <MuiIconButton size="small" onClick={handleToggle} sx={{ p: 0.25 }}>
        {isRevealed ? <LuEyeOff size={14} /> : <LuEye size={14} />}
      </MuiIconButton>
      {copyable && <CopyButton value={value} size="xs" />}
    </Box>
  );
}

SecretValueMask.displayName = 'SecretValueMask';
