import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import ListSubheader from '@mui/material/ListSubheader';
import type { SelectChangeEvent } from '@mui/material/Select';
import type { SxProps, Theme } from '@mui/material/styles';

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  parameterCount?: string;
}

export interface ModelSelectorProps {
  models: ModelInfo[];
  value?: string;
  onChange: (modelId: string) => void;
  grouped?: boolean;
  size?: 'small' | 'medium';
  sx?: SxProps<Theme>;
}

export default function ModelSelector({
  models,
  value = '',
  onChange,
  grouped = true,
  size = 'small',
  sx,
}: ModelSelectorProps) {
  const groups = useMemo(() => {
    if (!grouped) return null;
    const map: Record<string, ModelInfo[]> = {};
    for (const m of models) {
      (map[m.provider] ??= []).push(m);
    }
    return map;
  }, [models, grouped]);

  const handleChange = (e: SelectChangeEvent) => {
    onChange(e.target.value);
  };

  return (
    <Select
      value={value}
      onChange={handleChange}
      size={size}
      displayEmpty
      renderValue={(selected) => {
        if (!selected) return <em style={{ color: 'var(--ov-fg-faint)' }}>Select model...</em>;
        const model = models.find((m) => m.id === selected);
        return model?.name ?? selected;
      }}
      sx={{
        minWidth: 200,
        bgcolor: 'var(--ov-bg-surface)',
        '& .MuiOutlinedInput-notchedOutline': {
          borderColor: 'var(--ov-border-default)',
        },
        '&:hover .MuiOutlinedInput-notchedOutline': {
          borderColor: 'var(--ov-accent)',
        },
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {groups
        ? Object.entries(groups).flatMap(([provider, items]) => [
            <ListSubheader
              key={`header-${provider}`}
              sx={{
                bgcolor: 'var(--ov-bg-surface-inset)',
                color: 'var(--ov-fg-muted)',
                fontSize: 'var(--ov-text-xs)',
                fontWeight: 600,
                textTransform: 'uppercase',
                lineHeight: '28px',
              }}
            >
              {provider}
            </ListSubheader>,
            ...items.map((m) => (
              <MenuItem key={m.id} value={m.id}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                  <Typography sx={{ fontSize: 'var(--ov-text-sm)', flex: 1 }}>
                    {m.name}
                  </Typography>
                  {m.parameterCount && (
                    <Typography
                      sx={{
                        fontSize: 'var(--ov-text-xs)',
                        color: 'var(--ov-fg-faint)',
                        fontFamily: 'var(--ov-font-mono)',
                      }}
                    >
                      {m.parameterCount}
                    </Typography>
                  )}
                  {m.contextWindow && (
                    <Typography
                      sx={{
                        fontSize: 'var(--ov-text-xs)',
                        color: 'var(--ov-fg-faint)',
                        fontFamily: 'var(--ov-font-mono)',
                      }}
                    >
                      {m.contextWindow >= 1000
                        ? `${Math.round(m.contextWindow / 1000)}k ctx`
                        : `${m.contextWindow} ctx`}
                    </Typography>
                  )}
                </Box>
              </MenuItem>
            )),
          ])
        : models.map((m) => (
            <MenuItem key={m.id} value={m.id}>
              <Typography sx={{ fontSize: 'var(--ov-text-sm)' }}>{m.name}</Typography>
            </MenuItem>
          ))}
    </Select>
  );
}

ModelSelector.displayName = 'ModelSelector';
