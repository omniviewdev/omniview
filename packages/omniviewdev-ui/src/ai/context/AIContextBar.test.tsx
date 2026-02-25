import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AIContextBar from './AIContextBar';

describe('AIContextBar', () => {
  it('renders nothing when no segments provided', () => {
    const { container } = render(<AIContextBar />);
    expect(container.firstChild).toBeNull();
  });

  it('renders provider chip', () => {
    render(<AIContextBar provider={{ label: 'Kubernetes' }} />);
    expect(screen.getByText('Kubernetes')).toBeInTheDocument();
  });

  it('renders connection chip', () => {
    render(
      <AIContextBar
        provider={{ label: 'AWS' }}
        connection={{ label: 'prod-account' }}
      />,
    );
    expect(screen.getByText('AWS')).toBeInTheDocument();
    expect(screen.getByText('prod-account')).toBeInTheDocument();
  });

  it('renders scope with label and value', () => {
    render(
      <AIContextBar
        provider={{ label: 'Kubernetes' }}
        scope={{ label: 'Namespace', value: 'default' }}
      />,
    );
    expect(screen.getByText('Namespace: default')).toBeInTheDocument();
  });

  it('renders resource with kind/name', () => {
    render(
      <AIContextBar
        provider={{ label: 'Kubernetes' }}
        resource={{ kind: 'Pod', name: 'nginx-abc' }}
      />,
    );
    expect(screen.getByText('Pod/nginx-abc')).toBeInTheDocument();
  });

  it('shows change scope button when onChangeScope provided', () => {
    const handleChange = vi.fn();
    render(
      <AIContextBar
        provider={{ label: 'AWS' }}
        onChangeScope={handleChange}
      />,
    );
    fireEvent.click(screen.getByLabelText('Change scope'));
    expect(handleChange).toHaveBeenCalledOnce();
  });

  it('hides change scope button when no callback', () => {
    render(<AIContextBar provider={{ label: 'AWS' }} />);
    expect(screen.queryByLabelText('Change scope')).not.toBeInTheDocument();
  });
});
