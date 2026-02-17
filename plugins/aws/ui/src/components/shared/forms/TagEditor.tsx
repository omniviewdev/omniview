import React, { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  IconButton,
  Input,
  Stack,
  Typography,
} from '@mui/joy';
import { LuPlus, LuTrash2 } from 'react-icons/lu';

export type Tag = {
  Key: string;
  Value: string;
};

type Props = {
  tags: Tag[];
  onChange: (tags: Tag[]) => void;
  onSave?: () => void;
  onReset?: () => void;
  dirty?: boolean;
  saving?: boolean;
  readOnly?: boolean;
  maxTags?: number;
};

const TagEditor: React.FC<Props> = ({
  tags,
  onChange,
  onSave,
  onReset,
  dirty,
  saving,
  readOnly,
  maxTags = 50,
}) => {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const handleAdd = () => {
    const key = newKey.trim();
    if (!key) return;
    if (tags.some((t) => t.Key === key)) return;
    onChange([...tags, { Key: key, Value: newValue.trim() }]);
    setNewKey('');
    setNewValue('');
  };

  const handleRemove = (index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  const handleKeyChange = (index: number, value: string) => {
    const updated = [...tags];
    updated[index] = { ...updated[index], Key: value };
    onChange(updated);
  };

  const handleValueChange = (index: number, value: string) => {
    const updated = [...tags];
    updated[index] = { ...updated[index], Value: value };
    onChange(updated);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <Card
      sx={{ '--Card-padding': '0px', '--Card-gap': '0px', borderRadius: 'sm', gap: '0px' }}
      variant='outlined'
    >
      <Box sx={{ py: 1, px: 1.25 }}>
        <Stack direction='row' spacing={1} alignItems='center' justifyContent='space-between'>
          <Stack direction='row' spacing={1} alignItems='center'>
            <Typography level='title-sm'>Tags</Typography>
            <Typography level='body-xs' color='neutral'>({tags.length})</Typography>
          </Stack>
          {(onSave || onReset) && (
            <Stack direction='row' spacing={0.5}>
              {onReset && (
                <Button size='sm' variant='plain' color='neutral' disabled={!dirty || saving} onClick={onReset}>
                  Reset
                </Button>
              )}
              {onSave && (
                <Button size='sm' variant='soft' color='primary' disabled={!dirty || saving} loading={saving} onClick={onSave}>
                  Save
                </Button>
              )}
            </Stack>
          )}
        </Stack>
      </Box>
      <Divider />
      <CardContent
        sx={{
          p: 0,
          backgroundColor: 'background.level1',
          borderBottomRightRadius: 6,
          borderBottomLeftRadius: 6,
        }}
      >
        {/* Header row */}
        <Stack
          direction='row'
          spacing={1}
          sx={{ px: 1.5, py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}
        >
          <Typography level='body-xs' fontWeight={700} sx={{ flex: 1 }}>Key</Typography>
          <Typography level='body-xs' fontWeight={700} sx={{ flex: 1 }}>Value</Typography>
          {!readOnly && <Box sx={{ width: 32 }} />}
        </Stack>

        {/* Tag rows */}
        {tags.map((tag, i) => (
          <Stack
            key={i}
            direction='row'
            spacing={1}
            alignItems='center'
            sx={{
              px: 1.5,
              py: 0.25,
              '&:hover': { bgcolor: 'background.level2' },
              borderBottom: i < tags.length - 1 ? '1px solid' : undefined,
              borderColor: 'divider',
            }}
          >
            {readOnly ? (
              <>
                <Typography level='body-xs' sx={{ flex: 1, fontFamily: 'monospace' }}>{tag.Key}</Typography>
                <Typography level='body-xs' fontWeight={600} sx={{ flex: 1, fontFamily: 'monospace' }}>{tag.Value}</Typography>
              </>
            ) : (
              <>
                <Input
                  size='sm'
                  variant='plain'
                  value={tag.Key}
                  onChange={(e) => handleKeyChange(i, e.target.value)}
                  sx={{ flex: 1, fontSize: 12, fontFamily: 'monospace', '--Input-focusedHighlight': 'transparent' }}
                />
                <Input
                  size='sm'
                  variant='plain'
                  value={tag.Value}
                  onChange={(e) => handleValueChange(i, e.target.value)}
                  sx={{ flex: 1, fontSize: 12, fontFamily: 'monospace', '--Input-focusedHighlight': 'transparent' }}
                />
                <IconButton size='sm' variant='plain' color='danger' onClick={() => handleRemove(i)}>
                  <LuTrash2 size={14} />
                </IconButton>
              </>
            )}
          </Stack>
        ))}

        {tags.length === 0 && (
          <Box sx={{ px: 1.5, py: 1.5 }}>
            <Typography level='body-xs' color='neutral' textAlign='center'>No tags</Typography>
          </Box>
        )}

        {/* Add row */}
        {!readOnly && tags.length < maxTags && (
          <>
            <Divider />
            <Stack direction='row' spacing={1} alignItems='center' sx={{ px: 1.5, py: 0.5 }}>
              <Input
                size='sm'
                variant='soft'
                placeholder='Key'
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                onKeyDown={handleKeyDown}
                sx={{ flex: 1, fontSize: 12 }}
              />
              <Input
                size='sm'
                variant='soft'
                placeholder='Value'
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={handleKeyDown}
                sx={{ flex: 1, fontSize: 12 }}
              />
              <IconButton
                size='sm'
                variant='soft'
                color='primary'
                disabled={!newKey.trim()}
                onClick={handleAdd}
              >
                <LuPlus size={14} />
              </IconButton>
            </Stack>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default TagEditor;
