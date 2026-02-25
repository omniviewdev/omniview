import React from 'react';
import Box from '@mui/material/Box';
import Modal from '@mui/material/Modal';
import Slider from '@mui/material/Slider';
import Input from '@mui/material/Input';
import { LuScaling, LuX } from 'react-icons/lu';

type ScaleModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (replicas: number) => void;
  resourceType: string;
  resourceName: string;
  currentReplicas: number;
  isExecuting?: boolean;
};

const ScaleModal: React.FC<ScaleModalProps> = ({
  open,
  onClose,
  onConfirm,
  resourceType,
  resourceName,
  currentReplicas,
  isExecuting,
}) => {
  const [replicas, setReplicas] = React.useState(currentReplicas);

  React.useEffect(() => {
    if (open) setReplicas(currentReplicas);
  }, [open, currentReplicas]);

  const maxSlider = Math.max(currentReplicas * 3, 10);

  const handleSliderChange = (_: Event, value: number | number[]) => {
    setReplicas(value as number);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 0) setReplicas(val);
  };

  return (
    <Modal open={open} onClose={onClose}>
      <Box
        sx={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          bgcolor: 'var(--ov-bg-elevated, #1c2128)',
          border: '1px solid var(--ov-border-default, #30363d)',
          borderRadius: '12px',
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          color: 'var(--ov-fg-default, #c9d1d9)',
          width: 400,
          p: 0,
          outline: 'none',
        }}
      >
        {/* Header */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2,
            py: 1.5,
            borderBottom: '1px solid var(--ov-border-default, #30363d)',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LuScaling size={16} color="#58a6ff" />
            <Box
              sx={{
                fontSize: '0.875rem',
                fontWeight: 600,
                fontFamily: 'var(--ov-font-ui)',
                color: 'var(--ov-fg-base, #e6edf3)',
              }}
            >
              Scale {resourceType}
            </Box>
          </Box>
          <Box
            component="button"
            onClick={onClose}
            sx={{
              all: 'unset',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              p: 0.5,
              borderRadius: '4px',
              color: 'var(--ov-fg-muted, #8b949e)',
              '&:hover': { bgcolor: 'rgba(255,255,255,0.08)' },
            }}
          >
            <LuX size={14} />
          </Box>
        </Box>

        {/* Body */}
        <Box sx={{ px: 2, py: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box
            sx={{
              fontSize: '0.8125rem',
              fontFamily: 'var(--ov-font-mono, monospace)',
              color: 'var(--ov-fg-base, #e6edf3)',
              fontWeight: 600,
            }}
          >
            {resourceName}
          </Box>

          {/* Current vs Desired */}
          <Box sx={{ display: 'flex', gap: 3 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
              <Box sx={{ fontSize: '0.6875rem', color: 'var(--ov-fg-faint, #8b949e)', mb: 0.5 }}>
                Current
              </Box>
              <Box
                sx={{
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  fontFamily: 'var(--ov-font-mono, monospace)',
                  color: 'var(--ov-fg-muted, #8b949e)',
                }}
              >
                {currentReplicas}
              </Box>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', color: 'var(--ov-fg-faint, #484f58)' }}>
              →
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
              <Box sx={{ fontSize: '0.6875rem', color: 'var(--ov-fg-faint, #8b949e)', mb: 0.5 }}>
                Desired
              </Box>
              <Box
                sx={{
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  fontFamily: 'var(--ov-font-mono, monospace)',
                  color: replicas !== currentReplicas ? '#58a6ff' : 'var(--ov-fg-base, #e6edf3)',
                }}
              >
                {replicas}
              </Box>
            </Box>
          </Box>

          {/* Slider + Input */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Slider
              value={replicas}
              onChange={handleSliderChange}
              min={0}
              max={maxSlider}
              step={1}
              sx={{
                flex: 1,
                color: '#58a6ff',
                '& .MuiSlider-thumb': { width: 14, height: 14 },
              }}
            />
            <Input
              value={replicas}
              onChange={handleInputChange}
              inputProps={{ min: 0, step: 1, type: 'number' }}
              sx={{
                width: 56,
                fontSize: '0.8125rem',
                fontFamily: 'var(--ov-font-mono, monospace)',
                color: 'var(--ov-fg-base, #e6edf3)',
                '& input': { textAlign: 'center' },
              }}
            />
          </Box>

          {replicas === 0 && (
            <Box
              sx={{
                p: 0.75,
                borderRadius: '4px',
                bgcolor: 'rgba(210,153,34,0.1)',
                border: '1px solid rgba(210,153,34,0.3)',
                fontSize: '0.6875rem',
                color: '#d29922',
              }}
            >
              Scaling to 0 will stop all pods in this {resourceType.toLowerCase()}.
            </Box>
          )}
        </Box>

        {/* Footer */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 1,
            px: 2,
            py: 1.5,
            borderTop: '1px solid var(--ov-border-default, #30363d)',
          }}
        >
          <Box
            component="button"
            onClick={onClose}
            sx={{
              all: 'unset',
              px: 2,
              py: 0.75,
              fontSize: '0.75rem',
              fontWeight: 500,
              fontFamily: 'var(--ov-font-ui)',
              color: 'var(--ov-fg-default, #c9d1d9)',
              borderRadius: '6px',
              cursor: 'pointer',
              border: '1px solid var(--ov-border-default, #30363d)',
              '&:hover': { bgcolor: 'rgba(255,255,255,0.06)' },
            }}
          >
            Cancel
          </Box>
          <Box
            component="button"
            onClick={() => onConfirm(replicas)}
            sx={{
              all: 'unset',
              px: 2,
              py: 0.75,
              fontSize: '0.75rem',
              fontWeight: 600,
              fontFamily: 'var(--ov-font-ui)',
              color: '#fff',
              bgcolor: replicas !== currentReplicas ? '#238636' : '#30363d',
              borderRadius: '6px',
              cursor: replicas !== currentReplicas ? 'pointer' : 'default',
              opacity: replicas !== currentReplicas && !isExecuting ? 1 : 0.5,
              pointerEvents: replicas !== currentReplicas && !isExecuting ? 'auto' : 'none',
              '&:hover': { bgcolor: replicas !== currentReplicas ? '#2ea043' : undefined },
            }}
          >
            {isExecuting ? 'Scaling...' : 'Scale'}
          </Box>
        </Box>
      </Box>
    </Modal>
  );
};

export default ScaleModal;
