import React from 'react';
import { FileDialogOptions, SettingType } from '@omniviewdev/runtime/models';
import type { Setting } from '@omniviewdev/runtime/models';
import { OpenFileSelectionDialog } from '@omniviewdev/runtime/api';
import styles from './SettingsEntry.module.css';

type Props = {
  setting: Setting;
  id: string;
  draftValue: unknown;
  handleChange: (name: string, value: unknown) => void;
  inputId?: string;
  labelledBy?: string;
  describedBy?: string;
};

function sameSettingValue(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }

  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) {
    return false;
  }

  if (Array.isArray(left)) {
    return Array.isArray(right) && left.length === right.length
      && left.every((value, index) => sameSettingValue(value, right[index]));
  }

  if (Array.isArray(right)) {
    return false;
  }

  const leftObject = left as Record<string, unknown>;
  const rightObject = right as Record<string, unknown>;
  const keys = Object.keys(leftObject);
  return keys.length === Object.keys(rightObject).length
    && keys.every(key => Object.prototype.hasOwnProperty.call(rightObject, key) && sameSettingValue(leftObject[key], rightObject[key]));
}

/** Generic editor preserves option values instead of coercing them into labels. */
export default function SettingsEntry({ setting, id, draftValue, handleChange, inputId, labelledBy, describedBy }: Props) {
  const [error, setError] = React.useState('');
  const value = draftValue !== undefined ? draftValue : setting.value;
  const change = (next: unknown) => {
    handleChange(id, next); 
  };

  const attributes = { id: inputId, 'aria-labelledby': labelledBy, 'aria-describedby': describedBy, 'aria-label': labelledBy ? undefined : setting.label };
  const sensitive = setting.sensitive || setting.type === SettingType.Password;
  const options = setting.options ?? [];
  const array = setting.type === SettingType.MultiSelect || Array.isArray(value);
  let editor: React.ReactNode;
  if (options.length) {
    const selected = array ? (Array.isArray(value) ? value : []) : [value];
    editor = <select {...attributes} multiple={array} value={array ? options.flatMap((option, index) => selected.some(item => sameSettingValue(item, option.value)) ? [String(index)] : []) : String(options.findIndex(option => sameSettingValue(value, option.value)))} onChange={event => {
      if (array) {
        change(Array.from(event.target.selectedOptions).map(option => options[Number(option.value)].value));
      } else {
        change(options[Number(event.target.value)].value);
      }
    }}>
      {!array && <option value='-1' disabled>Select a value</option>}
      {options.map((option, index) => <option key={index} value={String(index)}>{option.label}</option>)}
    </select>;
  } else if (setting.type === SettingType.Toggle) {
    editor = <input {...attributes} type='checkbox' checked={Boolean(value)} onChange={event => {
      change(event.target.checked); 
    }} />;
  } else if (array) {
    editor = <textarea {...attributes} value={Array.isArray(value) ? value.join('\n') : ''} onChange={event => {
      change(event.target.value === '' ? [] : event.target.value.split('\n'));
    }} spellCheck={false} />;
  } else if ([SettingType.Text, SettingType.Password, SettingType.Integer, SettingType.Float, SettingType.Color, SettingType.DateTime].includes(setting.type)) {
    const numeric = setting.type === SettingType.Integer || setting.type === SettingType.Float;
    editor = <input {...attributes} type={sensitive ? 'password' : numeric ? 'number' : 'text'}
      step={setting.type === SettingType.Integer ? 1 : 'any'} value={value == null ? '' : String(value)}
      placeholder={setting.type === SettingType.DateTime ? 'RFC 3339 date and time' : undefined}
      autoComplete={sensitive ? 'new-password' : 'off'} spellCheck={false}
      onChange={event => {
        change(numeric && event.target.value !== '' ? Number(event.target.value) : event.target.value); 
      }} />;
  } else {
    editor = <p role='status'>Unsupported setting type: {setting.type || 'unknown'}. No changes can be made with this editor.</p>;
  }

  const file = setting.fileSelection;
  return <div className={styles.Field}>{editor}
    {setting.type === SettingType.Color && !sensitive && <input type='color' aria-label={`${setting.label} color picker`}
      value={typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={event => {
        change(event.target.value); 
      }} />}
    {setting.type === SettingType.DateTime && !sensitive && <p>Enter a date and time with timezone, such as 2026-11-01T09:00:00Z.</p>}
    {file?.enabled && <>
      <button type='button' disabled={file.allowFolders || file.relative} onClick={async () => {
        setError('');
        try {
          const paths = await OpenFileSelectionDialog(FileDialogOptions.createFrom({ defaultDirectory: file.defaultPath,
            filters: file.extensions?.length ? [{ displayName: 'Allowed files', pattern: file.extensions.map(extension => `*.${extension.replace(/^\./, '')}`).join(';') }] : [],
          }));
          if (!paths?.length) {
            return;
          }

          const selected = file.multiple ? paths : paths.slice(0, 1);
          if (file.extensions?.length && selected.some(path => !file.extensions.some(extension => path.toLowerCase().endsWith(`.${extension.replace(/^\./, '').toLowerCase()}`)))) {
            setError('Choose a file with an allowed extension.'); return;
          }

          change(array ? [...(Array.isArray(value) ? value : []), ...selected] : selected[0]);
        } catch {
          setError('Could not open file selection. Enter the path manually.'); 
        }
      }}>Select {file.multiple ? 'files' : 'file'}</button>
      {(file.allowFolders || file.relative) && <p role='status'>Enter {file.relative ? 'relative paths' : 'folder paths'} manually; the native picker does not support this constraint.</p>}
    </>}
    {error && <p role='alert'>{error}</p>}
  </div>;
}
