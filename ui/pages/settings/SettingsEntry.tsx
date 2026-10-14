import React from 'react';

import { Checkbox, IconButton, MultiSelect, Select, TagInput, TextField } from '@omniviewdev/base-ui';

// Hooks
import { FileDialogOptions, SettingType } from '@omniviewdev/runtime/models';
import type { Setting } from '@omniviewdev/runtime/models';
import { parseAppError } from '@omniviewdev/runtime';
import { LuChevronDown, LuFile } from 'react-icons/lu';
import { OpenFileSelectionDialog } from '@omniviewdev/runtime/api';
import styles from './SettingsEntry.module.css';

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

const cx = (...classes: Array<string | false | undefined>) => classes.filter(Boolean).join(' ');

type SelectOption = { value: string; label: string };

type SettingSelectProps = {
  value: string;
  options: SelectOption[];
  isChanged: boolean;
  onChange: (value: string) => void;
};

/**
 * Single-value select over an `options` array (the call shape of the legacy
 * design system's Select), built on the base-ui Select compound.
 */
const SettingSelect: React.FC<SettingSelectProps> = ({ value, options, isChanged, onChange }) => (
  <Select.Root
    size='sm'
    value={value}
    items={options}
    onValueChange={(next) => {
      if (next !== null) {
        onChange(next);
      }
    }}
  >
    <Select.Trigger className={cx(styles.SelectTrigger, isChanged && styles.Changed)}>
      <Select.Value />
      <Select.Icon>
        <LuChevronDown aria-hidden />
      </Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Positioner sideOffset={4}>
        <Select.Popup>
          <Select.List>
            {options.map(option => (
              <Select.Item key={String(option.value)} value={option.value}>
                <Select.ItemText>{option.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.List>
        </Select.Popup>
      </Select.Positioner>
    </Select.Portal>
  </Select.Root>
);

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

  if (Array.isArray(setting.value) || Array.isArray(setting.default)) {
    return <MultiSelectSetting setting={setting} id={id} draftValue={draftValue} handleChange={handleChange} />;
  }

  if (setting.options?.length) {
    return <SelectSetting setting={setting} id={id} draftValue={draftValue} handleChange={handleChange} />;
  }

  // Normal single input
  return (
    <TextField.Root size='sm' className={styles.Field}>
      <TextField.Control
        className={cx(isChanged && styles.Changed)}
        value={isChanged ? draftValue as string : setting.value as string}
        onChange={e => {
          handleChange(id, e.target.value);
        }}
      />
    </TextField.Root>
  );
};

const SelectSetting: React.FC<Props> = ({ setting, id, draftValue, handleChange }) => {
  const isChanged = draftValue !== undefined;

  return (
    <SettingSelect
      value={isChanged ? draftValue as string : setting.value as string}
      isChanged={isChanged}
      onChange={(value) => {
        handleChange(id, value);
      }}
      options={setting.options.map(option => ({
        value: option.value as string,
        label: option.label,
      }))}
    />
  );
};

const MultiSelectSetting: React.FC<Props> = ({ setting, id, draftValue, handleChange }) => {
  const isChanged = draftValue !== undefined;
  const selectedValues = toStringArray(isChanged ? draftValue : setting.value);

  return (
    <div className={styles.MultiRow}>
      {setting.options?.length ? (
        <MultiSelect
          size='sm'
          className={cx(styles.MultiInput, isChanged && styles.Changed)}
          value={selectedValues}
          onValueChange={(value) => {
            handleChange(id, value);
          }}
          items={setting.options.map(option => option.value as string)}
          getItemLabel={(value) => {
            const option = setting.options.find((o: { value: unknown }) => o.value === value);
            return option ? option.label : String(value);
          }}
        />
      ) : (
        <TagInput
          size='sm'
          className={cx(styles.MultiInput, isChanged && styles.Changed)}
          value={selectedValues}
          onChange={(val) => {
            handleChange(id, val);
          }}
          placeholder={selectedValues.length > 0 ? undefined : 'Values'}
        />
      )}
      {setting.fileSelection?.enabled ? (
        <IconButton size='sm' variant='soft' color='neutral' aria-label='Select files' onClick={async () => {
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
    </div>
  );
};

const ToggleSetting: React.FC<Props> = ({ setting, id, draftValue, handleChange }) => (
  <Checkbox
    checked={draftValue !== undefined ? !!draftValue : !!setting.value}
    onCheckedChange={checked => {
      handleChange(id, checked);
    }}
  />
);

const NumberSetting: React.FC<Props> = ({ setting, id, draftValue, handleChange }) => {
  const isChanged = draftValue !== undefined;

  if (!setting.options?.length) {
    return (
      <TextField.Root size='sm' className={styles.Field}>
        <TextField.Control
          type='number'
          className={cx(isChanged && styles.Changed)}
          value={isChanged ? String(+draftValue) : String(+setting.value)}
          onChange={e => {
            handleChange(id, +e.target.value);
          }}
        />
      </TextField.Root>
    );
  }

  return (
    <SettingSelect
      value={isChanged ? String(!!draftValue) : String(!!setting.value)}
      isChanged={isChanged}
      onChange={(value) => {
        handleChange(id, value);
      }}
      options={setting.options.map(option => ({
        value: option.value as string,
        label: option.label,
      }))}
    />
  );
};

export default SettingsEntry;
