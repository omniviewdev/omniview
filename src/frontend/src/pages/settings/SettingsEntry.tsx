import React from 'react';

// Material-ui
import Checkbox from '@mui/joy/Checkbox';
import Input from '@mui/joy/Input';
import Select from '@mui/joy/Select';
import Option from '@mui/joy/Option';

// Hooks
import { settings } from '@api/models';
import { Autocomplete } from '@mui/joy';

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

  if (Array.isArray(setting.value)) {
    return (
      <Autocomplete
        multiple
        freeSolo={setting.options?.length === 0}
        placeholder={setting.value.length > 0 ? undefined : 'Kubeconfigs'}
        value={isChanged ? draftValue as string[] : setting.value as string[]}
        onChange={(_, val) => {
          handleChange(id, val);
        }}
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        options={setting.options.map(option => ({ label: option.label, id: option.value }))}
        sx={{
          ...(isChanged && {
            outline: '2px solid var(--Select-focusedHighlight)',
            outlineOffset: '2px',
          }),
        }}
      />
    );
  }

  if (setting.options?.length) {
    return (
    // Options selection
      <Select
        variant='outlined'
        name={id}
        value={isChanged ? draftValue as string : setting.value as string}
        onChange={(_, val) => {
          handleChange(id, val);
        }}
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
      >
        {setting.options.map(option => (
          /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment */
          <Option key={option.value} value={option.value}>{option.label}</Option>
        ))}
      </Select>
    );
  }

  // Normal single input
  return (
    <Input
      variant='outlined'
      name={id}
      value={isChanged ? draftValue as string : setting.value as string}
      onChange={e => {
        handleChange(id, e.target.value);
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
    variant='solid'
    name={id}
    checked={draftValue !== undefined ? !!draftValue : !!setting.value}
    onChange={e => {
      handleChange(id, e.target.checked);
    }}
  />
);

const NumberSetting: React.FC<Props> = ({ setting, id, draftValue, handleChange }) => {
  const inputRef = React.useRef<HTMLInputElement | undefined>(null);
  const isChanged = draftValue !== undefined;

  if (!setting.options?.length) {
    return (
      <Input
        type='number'
        variant='outlined'
        name={id}
        value={isChanged ? +draftValue : +setting.value}
        onChange={e => {
          handleChange(id, e.target.value);
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
        slotProps={{
          input: {
            ref: inputRef as React.RefObject<HTMLInputElement>,
            step: setting.type === settings.SettingType.INTEGER ? 1 : 0.1,
          },
        }}
      />
    );
  }

  return (
    <Select
      variant='outlined'
      name={id}
      value={isChanged ? !!draftValue : !!setting.value}
      onChange={(_, val) => {
        handleChange(id, val);
      }}
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
    >
      {setting.options.map(option => (
        /* eslint-disable-next-line @typescript-eslint/no-unsafe-assignment */
        <Option key={option.value as string} value={option.value}>{option.label}</Option>
      ))}
    </Select>
  );
};

export default SettingsEntry;
