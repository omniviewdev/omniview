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
import { main, settings } from '@omniviewdev/runtime/models';
import { LuFile } from 'react-icons/lu';
import { OpenFileSelectionDialog } from '@omniviewdev/runtime/api';

type Props = {
  setting: settings.Setting;
  id: string;
  draftValue: any;
  handleChange: (name: string, value: any) => void;
};

/**
 * Renders a single setting entry based on the type of setting.
 */
const SettingsEntry: React.FC<Props> = ({ setting, id, draftValue, handleChange }) => {
  switch (setting.type) {
    case settings.SettingType.TEXT:
      /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment */
      return <TextSetting setting={setting} id={id} draftValue={draftValue} handleChange={handleChange} />;
    case settings.SettingType.TOGGLE:
      /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment */
      return <ToggleSetting setting={setting} id={id} draftValue={draftValue} handleChange={handleChange} />;
    case settings.SettingType.INTEGER:
    case settings.SettingType.FLOAT:
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

    OpenFileSelectionDialog(main.FileDialogOptions.createFrom({
      showHiddenFiles: true,
    })).then((result) => {
      console.log('File selection dialog result:', result);
      if (result) {
        newValue.push(...result);
        handleChange(id, newValue);
      }
    }).catch((err) => {
      console.error('Error opening file selection dialog:', err);
    });
  };

  if (Array.isArray(setting.value)) {
    return (
      <Stack direction='row' spacing={1} width={'100%'}>
        <Autocomplete
          size='small'
          multiple
          freeSolo={setting.options?.length === 0}
          value={isChanged ? draftValue as string[] : setting.value as string[]}
          onChange={(_, val) => {
            console.log('Autocomplete value:', val);
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
          renderInput={(params) => <MuiTextField {...params} placeholder={setting.value.length > 0 ? undefined : 'Kubeconfigs'} />}
        />
        {setting.fileSelection?.enabled ? (
          <IconButton size='sm' emphasis='soft' onClick={async () => handleFileSelection()}>
            <LuFile />
          </IconButton>
        ) : undefined
        }
      </Stack>
    );
  }

  if (setting.options?.length) {
    return (
      // Options selection
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
