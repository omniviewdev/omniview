import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Setting, SettingType } from '@omniviewdev/runtime/models';
import SettingsEntry from './SettingsEntry';

vi.mock('@omniviewdev/runtime/api', () => ({ OpenFileSelectionDialog: vi.fn() }));
afterEach(cleanup);

describe('generic setting editors', () => {
  it('preserves numeric and structured option values', () => {
    const onChange = vi.fn();
    const structuredValue = { mode: 'full' };
    render(<SettingsEntry id='choice' setting={new Setting({ label: 'Choice', type: SettingType.Select, value: 42,
      options: [{ label: 'Number', description: '', value: 42 }, { label: 'Object', description: '', value: structuredValue }],
    })} draftValue={undefined} handleChange={onChange} />);
    expect(screen.getByRole('combobox')).toHaveValue('0');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } });
    expect(onChange).toHaveBeenCalledWith('choice', structuredValue);
    expect(onChange.mock.calls[0][1]).toBe(structuredValue);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '0' } });
    expect(onChange).toHaveBeenLastCalledWith('choice', 42);
  });

  it.each([SettingType.Select, SettingType.MultiSelect])('matches saved %s objects regardless of nested key order while preserving array order and value types', type => {
    const savedValue = { nested: { attempts: 2, mode: 'full' }, sequence: [{ position: 1, label: 'first' }, 'last'] };
    const optionValue = { sequence: [{ label: 'first', position: 1 }, 'last'], nested: { mode: 'full', attempts: 2 } };
    const multiple = type === SettingType.MultiSelect;
    render(<SettingsEntry id='choice' setting={new Setting({ label: 'Choice', type,
      value: multiple ? [savedValue] : savedValue,
      options: [
        { label: 'Reversed sequence', description: '', value: { ...optionValue, sequence: [...optionValue.sequence].reverse() } },
        { label: 'Saved choice', description: '', value: optionValue },
        { label: 'Text attempts', description: '', value: { ...optionValue, nested: { mode: 'full', attempts: '2' } } },
      ],
    })} draftValue={undefined} handleChange={vi.fn()} />);
    expect(screen.getByLabelText('Choice')).toHaveValue(multiple ? ['1'] : '1');
    expect(screen.getByRole('option', { name: 'Saved choice' })).toHaveProperty('selected', true);
  });

  it('stages an empty list when array text is cleared', () => {
    const onChange = vi.fn();
    function DraftEditor() {
      const [draft, setDraft] = useState<unknown>(['first', 'second']);
      return <>
        <SettingsEntry id='entries' setting={new Setting({ label: 'Entries', type: SettingType.MultiSelect })}
          draftValue={draft} handleChange={(name, value) => {
            onChange(name, value);
            setDraft(value);
          }} />
        <output aria-label='Draft entries'>{JSON.stringify(draft)}</output>
      </>;
    }

    render(<DraftEditor />);
    fireEvent.change(screen.getByLabelText('Entries'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith('entries', []);
    expect(screen.getByLabelText('Entries')).toHaveValue('');
    expect(screen.getByLabelText('Draft entries')).toHaveTextContent('[]');
  });

  it.each([
    { text: 'first\n\n  second \n', entries: ['first', '', '  second ', ''] },
    { text: '  ', entries: ['  '] },
    { text: '\n', entries: ['', ''] },
  ])('preserves blank entries and whitespace in nonempty array text: $text', ({ text, entries }) => {
    const onChange = vi.fn();
    render(<SettingsEntry id='entries' setting={new Setting({ label: 'Entries', type: SettingType.MultiSelect, value: [] })}
      draftValue={undefined} handleChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Entries'), { target: { value: text } });
    expect(onChange).toHaveBeenCalledWith('entries', entries);
  });

  it('masks sensitive text and disables browser credential completion', () => {
    render(<SettingsEntry id='secret' setting={new Setting({ label: 'Secret', type: SettingType.Text, sensitive: true, value: 'private' })}
      draftValue={undefined} handleChange={vi.fn()} />);
    expect(screen.getByLabelText('Secret')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Secret')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.queryByText('private')).not.toBeInTheDocument();
  });

  it('shows an unsupported editor instead of an empty row', () => {
    render(<SettingsEntry id='unknown' setting={new Setting({ label: 'Unknown', type: 'future' as SettingType })}
      draftValue={undefined} handleChange={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Unsupported setting type: future');
  });
});
