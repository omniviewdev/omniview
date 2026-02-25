import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ModelSelector from './ModelSelector';

const models = [
  { id: 'gpt-4', name: 'GPT-4', provider: 'OpenAI', contextWindow: 128000 },
  { id: 'claude-3', name: 'Claude 3', provider: 'Anthropic', contextWindow: 200000 },
  { id: 'gpt-3.5', name: 'GPT-3.5', provider: 'OpenAI' },
];

describe('ModelSelector', () => {
  it('renders select with current value', () => {
    render(<ModelSelector models={models} value="gpt-4" onChange={vi.fn()} />);
    expect(screen.getByText('GPT-4')).toBeInTheDocument();
  });

  it('shows placeholder when no value', () => {
    render(<ModelSelector models={models} onChange={vi.fn()} />);
    expect(screen.getByText('Select model...')).toBeInTheDocument();
  });

  it('lists models when opened', () => {
    render(<ModelSelector models={models} value="" onChange={vi.fn()} />);
    // Open the select by clicking it
    const selectButton = screen.getByRole('combobox');
    fireEvent.mouseDown(selectButton);
    // Models should be listed in the dropdown
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText('GPT-4')).toBeInTheDocument();
    expect(within(listbox).getByText('Claude 3')).toBeInTheDocument();
    expect(within(listbox).getByText('GPT-3.5')).toBeInTheDocument();
  });

  it('selecting a model calls onChange with model id', () => {
    const onChange = vi.fn();
    render(<ModelSelector models={models} value="" onChange={onChange} />);
    const selectButton = screen.getByRole('combobox');
    fireEvent.mouseDown(selectButton);
    const listbox = screen.getByRole('listbox');
    fireEvent.click(within(listbox).getByText('Claude 3'));
    expect(onChange).toHaveBeenCalledWith('claude-3');
  });
});
