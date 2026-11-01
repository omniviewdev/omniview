import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Setting, SettingType } from '@omniviewdev/runtime/models';
import SettingsEntry from './SettingsEntry';

vi.mock('@omniviewdev/runtime/api', () => ({ OpenFileSelectionDialog: vi.fn() }));
afterEach(cleanup);

describe('generic setting editors', () => {
  it('preserves numeric and structured option values', () => {
    const onChange = vi.fn();
    render(<SettingsEntry id='choice' setting={new Setting({ label: 'Choice', type: SettingType.Select, value: 42,
      options: [{ label: 'Number', description: '', value: 42 }, { label: 'Object', description: '', value: { mode: 'full' } }],
    })} draftValue={undefined} handleChange={onChange} />);
    expect(screen.getByRole('combobox')).toHaveValue('0');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '1' } });
    expect(onChange).toHaveBeenCalledWith('choice', { mode: 'full' });
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
