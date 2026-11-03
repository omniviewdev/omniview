import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Setting, SettingType } from '@omniviewdev/runtime/models';
import SettingsEntry from './SettingsEntry';

vi.mock('@omniviewdev/runtime/api', () => ({ OpenFileSelectionDialog: vi.fn() }));
afterEach(cleanup);

describe('generic setting editors', () => {
  it('preserves numeric and structured option values', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const structuredValue = { mode: 'full' };
    function DraftChoice() {
      const [draft, setDraft] = useState<unknown>(42);
      return <SettingsEntry id='choice' setting={new Setting({ label: 'Choice', type: SettingType.Select,
        options: [{ label: 'Number', description: '', value: 42 }, { label: 'Object', description: '', value: structuredValue }],
      })} draftValue={draft} handleChange={(name, next) => {
        onChange(name, next);
        setDraft(next);
      }} />;
    }
    render(<DraftChoice />);
    expect(screen.getByRole('combobox')).toHaveTextContent('Number');
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Object' }));
    expect(onChange).toHaveBeenCalledWith('choice', structuredValue);
    expect(onChange.mock.calls[0][1]).toBe(structuredValue);
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Number' }));
    expect(onChange).toHaveBeenLastCalledWith('choice', 42);
  });

  it.each([SettingType.Select, SettingType.MultiSelect])('matches saved %s objects regardless of nested key order while preserving array order and value types', async type => {
    const user = userEvent.setup();
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
    expect(screen.getByRole('combobox', { name: 'Choice' })).toHaveTextContent('Saved choice');
    await user.click(screen.getByRole('combobox', { name: 'Choice' }));
    expect(await screen.findByRole('option', { name: 'Saved choice' })).toHaveAttribute('aria-selected', 'true');
  });

  it('adds and removes multi-select choices without coercing their values', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const object = { mode: 'full' };
    function DraftChoices() {
      const [draft, setDraft] = useState<unknown>([42]);
      return <SettingsEntry id='choices' setting={new Setting({ label: 'Choices', type: SettingType.MultiSelect,
        options: [{ label: 'Number', description: '', value: 42 }, { label: 'Object', description: '', value: object }],
      })} draftValue={draft} handleChange={(name, next) => {
        onChange(name, next);
        setDraft(next);
      }} />;
    }
    render(<DraftChoices />);
    await user.click(screen.getByRole('combobox', { name: 'Choices' }));
    await user.click(await screen.findByRole('option', { name: 'Object' }));
    expect(onChange).toHaveBeenLastCalledWith('choices', [42, object]);
    await user.click(screen.getByRole('option', { name: 'Number' }));
    expect(onChange).toHaveBeenLastCalledWith('choices', [object]);
    expect(onChange.mock.lastCall?.[1][0]).toBe(object);
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
