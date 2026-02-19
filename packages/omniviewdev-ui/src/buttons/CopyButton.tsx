import { useState, useCallback } from 'react';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';

import type { ComponentSize } from '../types';
import IconButton from './IconButton';

export interface CopyButtonProps {
  value: string;
  size?: ComponentSize;
  label?: string;
}

export default function CopyButton({ value, size = 'sm', label }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [value]);

  const iconSize = size === 'xs' ? 12 : size === 'sm' ? 14 : size === 'md' ? 16 : 18;

  return (
    <IconButton
      size={size}
      color={copied ? 'success' : 'neutral'}
      onClick={handleCopy}
      aria-label={label ?? (copied ? 'Copied' : 'Copy to clipboard')}
      title={label ?? (copied ? 'Copied!' : 'Copy')}
    >
      {copied ? (
        <CheckIcon sx={{ fontSize: iconSize }} />
      ) : (
        <ContentCopyIcon sx={{ fontSize: iconSize }} />
      )}
    </IconButton>
  );
}

CopyButton.displayName = 'CopyButton';
