import React from 'react';
import { Avatar, Box, Button, Stack, Typography } from '@mui/joy';
import { LuUpload, LuPalette, LuRotateCcw } from 'react-icons/lu';
import { PRESET_COLORS } from '../../utils/folderIcons';
import { getInitials } from '../../utils/avatarUtils';
import { processImageFile } from '../../utils/avatarUtils';
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
    <Stack gap={1.5} sx={{ minWidth: 200 }}>
      {/* Preview */}
      <Box
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        sx={{
          width: 80,
          height: 80,
          borderRadius: 'sm',
          border: dragOver ? '2px dashed' : '2px solid transparent',
          borderColor: dragOver ? 'primary.500' : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'border-color 0.15s',
        }}
      >
        {avatarUrl ? (
          <Avatar
            src={avatarUrl}
            sx={{ width: 80, height: 80, borderRadius: 'sm', '--Avatar-size': '80px' }}
          />
        ) : (
          <Avatar
            sx={{
              width: 80,
              height: 80,
              borderRadius: 'sm',
              bgcolor: bgColor,
              fontSize: '1.5rem',
              '--Avatar-size': '80px',
            }}
          >
            {initials}
          </Avatar>
        )}
      </Box>

      {/* Actions */}
      <Stack direction='row' gap={0.5} flexWrap='wrap'>
        <Button
          size='sm'
          variant='soft'
          color='neutral'
          startDecorator={<LuUpload size={14} />}
          onClick={() => fileInputRef.current?.click()}
        >
          Upload
        </Button>
        <Button
          size='sm'
          variant={showColors ? 'solid' : 'soft'}
          color={showColors ? 'primary' : 'neutral'}
          startDecorator={<LuPalette size={14} />}
          onClick={() => setShowColors(v => !v)}
        >
          Color
        </Button>
        {(avatarUrl || avatarColor) && (
          <Button
            size='sm'
            variant='soft'
            color='neutral'
            startDecorator={<LuRotateCcw size={14} />}
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
        <Stack direction='row' gap={0.5} flexWrap='wrap'>
          {PRESET_COLORS.map(color => (
            <Box
              key={color}
              onClick={() => handleColorPick(color)}
              sx={{
                width: 24,
                height: 24,
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
        <Typography level='body-xs' color='danger'>
          {error}
        </Typography>
      )}
    </Stack>
  );
};

export default AvatarEditor;
