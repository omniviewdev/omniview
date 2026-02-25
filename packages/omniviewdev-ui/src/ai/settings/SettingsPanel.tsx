import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Slider from '@mui/material/Slider';
import TextField from '@mui/material/TextField';
import type { SxProps, Theme } from '@mui/material/styles';

import ModelSelector from './ModelSelector';
import type { ModelInfo } from './ModelSelector';

export interface AISettingsValues {
  defaultModel: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  systemPrompt: string;
}

export interface SettingsPanelProps {
  models: ModelInfo[];
  values: AISettingsValues;
  onChange: (values: AISettingsValues) => void;
  children?: React.ReactNode;
  sx?: SxProps<Theme>;
}

export default function SettingsPanel({
  models,
  values,
  onChange,
  children,
  sx,
}: SettingsPanelProps) {
  const update = <K extends keyof AISettingsValues>(key: K, val: AISettingsValues[K]) => {
    onChange({ ...values, [key]: val });
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        maxWidth: 600,
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {/* Default model */}
      <Box>
        <Typography
          sx={{
            fontSize: 'var(--ov-text-sm)',
            fontWeight: 600,
            color: 'var(--ov-fg-default)',
            mb: 0.5,
          }}
        >
          Default Model
        </Typography>
        <ModelSelector
          models={models}
          value={values.defaultModel}
          onChange={(id) => update('defaultModel', id)}
          sx={{ width: '100%' }}
        />
      </Box>

      {/* Temperature */}
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{ fontSize: 'var(--ov-text-sm)', fontWeight: 600, color: 'var(--ov-fg-default)' }}>
            Temperature
          </Typography>
          <Typography sx={{ fontSize: 'var(--ov-text-sm)', color: 'var(--ov-fg-muted)', fontFamily: 'var(--ov-font-mono)' }}>
            {values.temperature.toFixed(2)}
          </Typography>
        </Box>
        <Slider
          value={values.temperature}
          onChange={(_, v) => update('temperature', v as number)}
          min={0}
          max={2}
          step={0.01}
          size="small"
          sx={{ color: 'var(--ov-accent)' }}
        />
      </Box>

      {/* Top P */}
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{ fontSize: 'var(--ov-text-sm)', fontWeight: 600, color: 'var(--ov-fg-default)' }}>
            Top P
          </Typography>
          <Typography sx={{ fontSize: 'var(--ov-text-sm)', color: 'var(--ov-fg-muted)', fontFamily: 'var(--ov-font-mono)' }}>
            {values.topP.toFixed(2)}
          </Typography>
        </Box>
        <Slider
          value={values.topP}
          onChange={(_, v) => update('topP', v as number)}
          min={0}
          max={1}
          step={0.01}
          size="small"
          sx={{ color: 'var(--ov-accent)' }}
        />
      </Box>

      {/* Max Tokens */}
      <Box>
        <Typography
          sx={{
            fontSize: 'var(--ov-text-sm)',
            fontWeight: 600,
            color: 'var(--ov-fg-default)',
            mb: 0.5,
          }}
        >
          Max Tokens
        </Typography>
        <TextField
          type="number"
          value={values.maxTokens}
          onChange={(e) => update('maxTokens', parseInt(e.target.value, 10) || 0)}
          size="small"
          fullWidth
          sx={{
            '& .MuiOutlinedInput-root': {
              bgcolor: 'var(--ov-bg-surface)',
              '& fieldset': { borderColor: 'var(--ov-border-default)' },
            },
          }}
        />
      </Box>

      {/* System Prompt */}
      <Box>
        <Typography
          sx={{
            fontSize: 'var(--ov-text-sm)',
            fontWeight: 600,
            color: 'var(--ov-fg-default)',
            mb: 0.5,
          }}
        >
          System Prompt
        </Typography>
        <TextField
          multiline
          minRows={3}
          maxRows={8}
          value={values.systemPrompt}
          onChange={(e) => update('systemPrompt', e.target.value)}
          fullWidth
          size="small"
          placeholder="You are a helpful DevOps assistant..."
          sx={{
            '& .MuiOutlinedInput-root': {
              bgcolor: 'var(--ov-bg-surface)',
              fontFamily: 'var(--ov-font-mono)',
              fontSize: 'var(--ov-text-sm)',
              '& fieldset': { borderColor: 'var(--ov-border-default)' },
            },
          }}
        />
      </Box>

      {children}
    </Box>
  );
}

SettingsPanel.displayName = 'SettingsPanel';
