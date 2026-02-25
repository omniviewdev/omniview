import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SettingsPanel from './SettingsPanel';

const models = [
  { id: 'gpt-4', name: 'GPT-4', provider: 'OpenAI' },
  { id: 'claude-3', name: 'Claude 3', provider: 'Anthropic' },
];

const defaultValues = {
  defaultModel: 'gpt-4',
  temperature: 0.7,
  topP: 1.0,
  maxTokens: 4096,
  systemPrompt: 'You are helpful.',
};

describe('SettingsPanel', () => {
  it('renders model selector with current value', () => {
    render(
      <SettingsPanel models={models} values={defaultValues} onChange={vi.fn()} />,
    );
    expect(screen.getByText('GPT-4')).toBeInTheDocument();
  });

  it('renders temperature label and value', () => {
    render(
      <SettingsPanel models={models} values={defaultValues} onChange={vi.fn()} />,
    );
    expect(screen.getByText('Temperature')).toBeInTheDocument();
    expect(screen.getByText('0.70')).toBeInTheDocument();
  });

  it('renders system prompt textarea with current value', () => {
    render(
      <SettingsPanel models={models} values={defaultValues} onChange={vi.fn()} />,
    );
    expect(screen.getByText('System Prompt')).toBeInTheDocument();
    expect(screen.getByDisplayValue('You are helpful.')).toBeInTheDocument();
  });

  it('onChange called when system prompt changes', () => {
    const onChange = vi.fn();
    render(
      <SettingsPanel models={models} values={defaultValues} onChange={onChange} />,
    );
    const textarea = screen.getByDisplayValue('You are helpful.');
    fireEvent.change(textarea, { target: { value: 'New prompt' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ systemPrompt: 'New prompt' }),
    );
  });
});
