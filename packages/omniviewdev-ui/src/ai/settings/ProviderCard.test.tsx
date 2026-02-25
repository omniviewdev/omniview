import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProviderCard from './ProviderCard';

const provider = {
  id: 'openai-1',
  name: 'OpenAI',
  type: 'openai' as const,
  endpoint: 'https://api.openai.com',
  status: 'connected' as const,
};

describe('ProviderCard', () => {
  it('displays provider name and endpoint', () => {
    render(
      <ProviderCard
        provider={provider}
        onConfigure={vi.fn()}
        onTestConnection={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText('https://api.openai.com')).toBeInTheDocument();
  });

  it('shows status label', () => {
    render(
      <ProviderCard
        provider={provider}
        onConfigure={vi.fn()}
        onTestConnection={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('Configure button calls onConfigure with provider id', () => {
    const onConfigure = vi.fn();
    render(
      <ProviderCard
        provider={provider}
        onConfigure={onConfigure}
        onTestConnection={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Configure' }));
    expect(onConfigure).toHaveBeenCalledWith('openai-1');
  });

  it('Test Connection button calls onTestConnection with provider id', () => {
    const onTestConnection = vi.fn();
    render(
      <ProviderCard
        provider={provider}
        onConfigure={vi.fn()}
        onTestConnection={onTestConnection}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));
    expect(onTestConnection).toHaveBeenCalledWith('openai-1');
  });

  it('remove button calls onRemove with provider id', () => {
    const onRemove = vi.fn();
    render(
      <ProviderCard
        provider={provider}
        onConfigure={vi.fn()}
        onTestConnection={vi.fn()}
        onRemove={onRemove}
      />,
    );
    const deleteIcon = screen.getByTestId('DeleteOutlineIcon');
    fireEvent.click(deleteIcon.closest('button')!);
    expect(onRemove).toHaveBeenCalledWith('openai-1');
  });
});
