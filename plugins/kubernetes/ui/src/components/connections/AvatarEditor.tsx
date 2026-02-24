import React from 'react';
import { Avatar } from '@omniviewdev/ui';
import MuiAvatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import { Button } from '@omniviewdev/ui/buttons';
import { Stack } from '@omniviewdev/ui/layout';
import { Text } from '@omniviewdev/ui/typography';
import { LuUpload, LuPalette, LuRotateCcw } from 'react-icons/lu';
import { PRESET_COLORS } from '../../utils/folderIcons';
import { getInitials, processImageFile } from '../../utils/avatarUtils';
import { stringToColor } from '../../utils/color';

type AvatarEditorProps = {
  name: string;
  avatarUrl: string;
  avatarColor: string;
  onAvatarUrlChange: (url: string) => void;
  onAvatarColorChange: (color: string) => void;
};

const AvatarEditor: React.FC<AvatarEditorProps> = ({
  name,
  avatarUrl,
  avatarColor,
  onAvatarUrlChange,
  onAvatarColorChange,
}) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [showColors, setShowColors] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [error, setError] = React.useState('');

  const initials = getInitials(name);
  const bgColor = avatarColor || stringToColor(name);

  const handleFile = async (file: File) => {
    setError('');
    try {
      const dataUrl = await processImageFile(file);
      onAvatarUrlChange(dataUrl);
      onAvatarColorChange('');
      setShowColors(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process image');
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset so the same file can be re-selected
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) handleFile(file);
  };

  const handleColorPick = (color: string) => {
    onAvatarColorChange(color);
    onAvatarUrlChange('');
  };

  const handleReset = () => {
    onAvatarUrlChange('');
    onAvatarColorChange('');
    setShowColors(false);
    setError('');
  };

  return (
    <Stack alignItems='center' gap={1.5} sx={{ minWidth: 180 }}>
      {/* Preview with drag-drop and hover overlay */}
      <Box
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        sx={{
          position: 'relative',
          width: 96,
          height: 96,
          borderRadius: 2,
          outline: dragOver ? '2px dashed' : '2px solid transparent',
          outlineColor: dragOver ? 'primary.500' : 'transparent',
          outlineOffset: 2,
          transition: 'outline-color 0.15s',
        }}
      >
        {avatarUrl ? (
          <Avatar
            src={avatarUrl}
            sx={{ width: 96, height: 96, borderRadius: 2, '--Avatar-size': '96px' }}
          />
        ) : (
          <MuiAvatar
            sx={{
              width: 96,
              height: 96,
              borderRadius: 2,
              bgcolor: bgColor,
              fontSize: '1.75rem',
            }}
          >
            {initials}
          </MuiAvatar>
        )}
        {/* Hover overlay */}
        <Box
          onClick={() => fileInputRef.current?.click()}
          sx={{
            position: 'absolute',
            inset: 0,
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'rgba(0,0,0,0.4)',
            opacity: 0,
            '&:hover': { opacity: 1 },
            transition: 'opacity 0.2s',
            cursor: 'pointer',
          }}
        >
          <LuUpload size={24} color='white' />
        </Box>
      </Box>

      {/* Actions */}
      <Stack direction='row' gap={0.75}>
        <Button
          size='sm'
          emphasis='outline'
          color='neutral'
          startAdornment={<LuUpload size={14} />}
          onClick={() => fileInputRef.current?.click()}
        >
          Upload
        </Button>
        <Button
          size='sm'
          emphasis={showColors ? 'solid' : 'outline'}
          color={showColors ? 'primary' : 'neutral'}
          startAdornment={<LuPalette size={14} />}
          onClick={() => setShowColors(v => !v)}
        >
          Color
        </Button>
        {(avatarUrl || avatarColor) && (
          <Button
            size='sm'
            emphasis='outline'
            color='neutral'
            startAdornment={<LuRotateCcw size={14} />}
            onClick={handleReset}
          >
            Reset
          </Button>
        )}
      </Stack>

      <input
        ref={fileInputRef}
        type='file'
        accept='image/*'
        hidden
        onChange={handleFileInput}
      />

      {/* Color swatches */}
      {showColors && (
        <Stack direction='row' gap={0.75} flexWrap='wrap' justifyContent='center'>
          {PRESET_COLORS.map(color => (
            <Box
              key={color}
              onClick={() => handleColorPick(color)}
              sx={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                bgcolor: color,
                cursor: 'pointer',
                border: avatarColor === color ? '2px solid' : '2px solid transparent',
                borderColor: avatarColor === color ? 'text.primary' : 'transparent',
                '&:hover': { opacity: 0.8 },
                transition: 'border-color 0.15s, opacity 0.15s',
              }}
            />
          ))}
        </Stack>
      )}

      {/* Error */}
      {error && (
        <Text size='xs' color='danger'>
          {error}
        </Text>
      )}
    </Stack>
  );
};

export default AvatarEditor;
