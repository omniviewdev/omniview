import React from 'react'

// material-ui
import Checkbox from '@mui/joy/Checkbox'
import Input from '@mui/joy/Input'
import Select from '@mui/joy/Select';
import Option from '@mui/joy/Option';

// hooks
import { settings } from '@api/models';

type Props = {
  setting: settings.Setting;
  id: string;
  draftValue: any;
  handleChange: (name: string, value: any) => void;
}

/**
 * Renders a single setting entry based on the type of setting.
 */
const SettingsEntry: React.FC<Props> = ({ setting, id, draftValue, handleChange }) => {
  switch (setting.type) {
    case settings.SettingType.TEXT:
      return <TextSetting setting={setting} id={id} draftValue={draftValue} handleChange={handleChange} />
    case settings.SettingType.TOGGLE:
      return <ToggleSetting setting={setting} id={id} draftValue={draftValue} handleChange={handleChange} />
    case settings.SettingType.INTEGER:
    case settings.SettingType.FLOAT:
      return <NumberSetting setting={setting} id={id} draftValue={draftValue} handleChange={handleChange} />
    default:
      return null
  }
}

const TextSetting: React.FC<Props> = ({ setting, id, draftValue, handleChange }) => {
  const isChanged = draftValue !== undefined;

  if (!setting.options?.length) {
    return (
      <Input
        variant="outlined"
        name={id}
        value={isChanged ? draftValue : setting.value}
        onChange={(e) => handleChange(id, e.target.value)}
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
    )
  } else {
    return (
      <Select
        variant="outlined"
        name={id}
        value={isChanged ? draftValue : setting.value}
        onChange={(_, val) => handleChange(id, val)}
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
        {setting.options.map((option) => (
          <Option key={option.value} value={option.value}>{option.label}</Option>
        ))}
      </Select>
    )
  }
}

const ToggleSetting: React.FC<Props> = ({ setting, id, draftValue, handleChange }) => (
  <Checkbox
    variant="solid"
    name={id}
    checked={draftValue !== undefined ? draftValue : setting.value}
    onChange={(e) => handleChange(id, e.target.checked)}
  />
)

const NumberSetting: React.FC<Props> = ({ setting, id, draftValue, handleChange }) => {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const isChanged = draftValue !== undefined;

  if (!setting.options?.length) {
    return (
      <Input
        type="number"
        variant="outlined"
        name={id}
        value={isChanged ? draftValue : setting.value}
        onChange={(e) => handleChange(id, e.target.value)}
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
            ref: inputRef,
            step: setting.type === 'integer' ? 1 : 0.1,
          },
        }}
      />
    )
  } else {
    return (
      <Select
        variant="outlined"
        name={id}
        value={isChanged ? draftValue : setting.value}
        onChange={(_, val) => handleChange(id, val)}
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
        {setting.options.map((option) => (
          <Option key={option.value} value={option.value}>{option.label}</Option>
        ))}
      </Select>
    )
  }
}

export default SettingsEntry;
