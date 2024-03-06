import React from 'react'

// material-ui
import Checkbox from '@mui/joy/Checkbox'
import Input from '@mui/joy/Input'
import Select from '@mui/joy/Select';
import Option from '@mui/joy/Option';

// hooks
import {
  FloatSetting as IFloatSetting,
  IntegerSetting as IIntegerSetting,
  SelectSetting as ISelectSetting,
  Setting as ISetting,
  TextSetting as ITextSetting,
  ToggleSetting as IToggleSetting,
} from '@/store/settings/types';

type Props = {
  setting: ISetting;
  id: string;
  draftValue: any;
  handleChange: (name: string, value: any) => void;
}

/** Enforce typescript to ensure that the setting type is handled based on it's type */

type TextSettingProps = Props & {
  setting: ITextSetting
}

type SelectSettingProps = Props & {
  setting: ISelectSetting
}

type ToggleSettingProps = Props & {
  setting: IToggleSetting
}

type NumberSettingProps = Props & {
  setting: IIntegerSetting | IFloatSetting
}


/**
 * Renders a single setting entry based on the type of setting.
 */
const SettingsEntry: React.FC<Props> = ({ setting, id, draftValue, handleChange }) => {
  switch (setting.type) {
    case 'text':
      return <TextSetting setting={setting} id={id} draftValue={draftValue} handleChange={handleChange} />
    case 'select':
      return <SelectSetting setting={setting} id={id} draftValue={draftValue} handleChange={handleChange} />
    case 'toggle':
      return <ToggleSetting setting={setting} id={id} draftValue={draftValue} handleChange={handleChange} />
    case 'integer':
    case 'float':
      return <NumberSetting setting={setting} id={id} draftValue={draftValue} handleChange={handleChange} />
    default:
      return null
  }
}

const TextSetting: React.FC<TextSettingProps> = ({ setting, id, draftValue, handleChange }) => {
  const isChanged = draftValue !== undefined;

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
}

const SelectSetting: React.FC<SelectSettingProps> = ({ setting, id, draftValue, handleChange }) => {
  const isChanged = draftValue !== undefined;

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

const ToggleSetting: React.FC<ToggleSettingProps> = ({ setting, id, draftValue, handleChange }) => (
  <Checkbox
    variant="solid"
    name={id}
    checked={draftValue !== undefined ? draftValue : setting.value}
    onChange={(e) => handleChange(id, e.target.checked)}
  />
)

const NumberSetting: React.FC<NumberSettingProps> = ({ setting, id, draftValue, handleChange }) => {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const isChanged = draftValue !== undefined;

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
          min: setting.min,
          max: setting.max,
          step: setting.type === 'integer' ? 1 : 0.1,
        },
      }}
    />
  )
}

export default SettingsEntry;
