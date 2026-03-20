import React from 'react';

// Material-ui
import Autocomplete from '@mui/material/Autocomplete';
import MuiTextField from '@mui/material/TextField';
import { IconButton } from '@omniviewdev/ui/buttons';
import { Checkbox } from '@omniviewdev/ui/inputs';
import { TextField } from '@omniviewdev/ui/inputs';
import { Select } from '@omniviewdev/ui/inputs';
import { Stack } from '@omniviewdev/ui/layout';

// Hooks
import { FileDialogOptions, SettingType } from '@omniviewdev/runtime/models';
import type { Setting } from '@omniviewdev/runtime/models';
import { parseAppError } from '@omniviewdev/runtime';
import { LuFile } from 'react-icons/lu';
import { OpenFileSelectionDialog } from '@omniviewdev/runtime/api';

type Props = {
  setting: Setting;
  id: string;
  draftValue: any;
  handleChange: (name: string, value: any) => void;
};

const toStringArray = (value: any): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(part => part.trim())
      .filter(Boolean);
  }
  return [];
};

/**
 * Renders a single setting entry based on the type of setting.
 */
const SettingsEntry: React.FC<Props> = ({ setting, id, draftValue, handleChange }) => {
  const settingType = setting.type as unknown as string;

  switch (settingType) {
    case SettingType.Text:
      /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment */
      return <TextSetting setting={setting} id={id} draftValue={draftValue} handleChange={handleChange} />;
    case 'select':
      /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment */
      return <SelectSetting setting={setting} id={id} draftValue={draftValue} handleChange={handleChange} />;
    case 'multiselect':
      /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment */
      return <MultiSelectSetting setting={setting} id={id} draftValue={draftValue} handleChange={handleChange} />;
    case SettingType.Toggle:
      /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment */
      return <ToggleSetting setting={setting} id={id} draftValue={draftValue} handleChange={handleChange} />;
    case SettingType.Integer:
    case SettingType.Float:
      /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment */
      return <NumberSetting setting={setting} id={id} draftValue={draftValue} handleChange={handleChange} />;
    default:
      return null;
  }
};

const TextSetting: React.FC<Props> = ({ setting, id, draftValue, handleChange }) => {
  const isChanged = draftValue !== undefined;

  const handleFileSelection = async () => {
    if (!setting.fileSelection?.enabled) {
      return;
    }

    let newValue = isChanged ? draftValue as string[] : setting.value as string[];
    if (!newValue) {
      newValue = [];
    }

    OpenFileSelectionDialog(FileDialogOptions.createFrom({
      showHiddenFiles: true,
    })).then((result) => {
      console.log('File selection dialog result:', result);
      if (result) {
        newValue.push(...result);
        handleChange(id, newValue);
      }
    }).catch((err: unknown) => {
      console.error('Error opening file selection dialog:', parseAppError(err).detail);
    });
  };

  if (Array.isArray(setting.value) || Array.isArray(setting.default)) {
    return <MultiSelectSetting setting={setting} id={id} draftValue={draftValue} handleChange={handleChange} />;
  }

  if (setting.options?.length) {
    return <SelectSetting setting={setting} id={id} draftValue={draftValue} handleChange={handleChange} />;
  }

  // Normal single input
  return (
    <TextField
      size='sm'
      fullWidth
      value={isChanged ? draftValue as string : setting.value as string}
      onChange={value => {
        handleChange(id, value);
      }}
      sx={{
        '&::before': {
          display: 'none',
        },
        '&:focus-within': {
          outline: '2px solid var(--Input-focusedHighlight)',
          outlineOffset: '2px',
        },
        ...(isChanged && {
          outline: '2px solid var(--Input-focusedHighlight)',
          outlineOffset: '2px',
        }),
      }}
    />
  );
};

const SelectSetting: React.FC<Props> = ({ setting, id, draftValue, handleChange }) => {
  const isChanged = draftValue !== undefined;

  return (
    <Select
      size='sm'
      fullWidth
      value={isChanged ? draftValue as string : setting.value as string}
      onChange={(value) => {
        handleChange(id, value);
      }}
      options={setting.options.map(option => ({
        value: option.value as string,
        label: option.label,
      }))}
      sx={{
        '&::before': {
          display: 'none',
        },
        '&:focus-within': {
          outline: '2px solid var(--Select-focusedHighlight)',
          outlineOffset: '2px',
        },
        ...(isChanged && {
          outline: '2px solid var(--Select-focusedHighlight)',
          outlineOffset: '2px',
        }),
      }}
    />
  );
};

const MultiSelectSetting: React.FC<Props> = ({ setting, id, draftValue, handleChange }) => {
  const isChanged = draftValue !== undefined;
  const selectedValues = toStringArray(isChanged ? draftValue : setting.value);

  return (
    <Stack direction='row' spacing={1} width={'100%'}>
      {setting.options?.length ? (
        <Select
          size='sm'
          fullWidth
          multiple
          value={selectedValues}
          onChange={(value) => {
            handleChange(id, value);
          }}
          options={setting.options.map(option => ({
            value: option.value as string,
            label: option.label,
          }))}
          sx={{
            '&::before': {
              display: 'none',
            },
            '&:focus-within': {
              outline: '2px solid var(--Select-focusedHighlight)',
              outlineOffset: '2px',
            },
            ...(isChanged && {
              outline: '2px solid var(--Select-focusedHighlight)',
              outlineOffset: '2px',
            }),
          }}
        />
      ) : (
        <Autocomplete
          size='small'
          multiple
          freeSolo
          value={selectedValues}
          onChange={(_, val) => {
            handleChange(id, val);
          }}
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          options={setting.options.map(option => ({ label: option.label, id: option.value }))}
          sx={{
            width: '100%',
            ...(isChanged && {
              outline: '2px solid var(--Select-focusedHighlight)',
              outlineOffset: '2px',
            }),
          }}
          renderInput={(params) => <MuiTextField {...params} placeholder={selectedValues.length > 0 ? undefined : 'Values'} />}
        />
      )}
      {setting.fileSelection?.enabled ? (
        <IconButton size='sm' emphasis='soft' onClick={async () => {
          if (!setting.fileSelection?.enabled) {
            return;
          }

          const newValue = toStringArray(isChanged ? draftValue : setting.value);

          OpenFileSelectionDialog(FileDialogOptions.createFrom({
            showHiddenFiles: true,
          })).then((result) => {
            if (result) {
              newValue.push(...result);
              handleChange(id, newValue);
            }
          }).catch((err: unknown) => {
            console.error('Error opening file selection dialog:', parseAppError(err).detail);
          });
        }}>
          <LuFile />
        </IconButton>
      ) : undefined}
    </Stack>
  );
};

const ToggleSetting: React.FC<Props> = ({ setting, id, draftValue, handleChange }) => (
  <Checkbox
    checked={draftValue !== undefined ? !!draftValue : !!setting.value}
    onChange={checked => {
      handleChange(id, checked);
    }}
  />
);

const NumberSetting: React.FC<Props> = ({ setting, id, draftValue, handleChange }) => {
  const isChanged = draftValue !== undefined;

  if (!setting.options?.length) {
    return (
      <TextField
        size='sm'
        fullWidth
        type='number'
        value={isChanged ? String(+draftValue) : String(+setting.value)}
        onChange={value => {
          handleChange(id, +value);
        }}
        sx={{
          '&::before': {
            display: 'none',
          },
          '&:focus-within': {
            outline: '2px solid var(--Input-focusedHighlight)',
            outlineOffset: '2px',
          },
          ...(isChanged && {
            outline: '2px solid var(--Input-focusedHighlight)',
            outlineOffset: '2px',
          }),
        }}
      />
    );
  }

  return (
    <Select
      size='sm'
      fullWidth
      value={isChanged ? String(!!draftValue) : String(!!setting.value)}
      onChange={(value) => {
        handleChange(id, value);
      }}
      options={setting.options.map(option => ({
        value: option.value as string,
        label: option.label,
      }))}
      sx={{
        '&::before': {
          display: 'none',
        },
        '&:focus-within': {
          outline: '2px solid var(--Select-focusedHighlight)',
          outlineOffset: '2px',
        },
        ...(isChanged && {
          outline: '2px solid var(--Select-focusedHighlight)',
          outlineOffset: '2px',
        }),
      }}
    />
  );
};

export default SettingsEntry;
