import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AIResourceCard from './AIResourceCard';

describe('AIResourceCard', () => {
  it('renders kind and name', () => {
    render(<AIResourceCard kind="Pod" name="nginx-abc" />);
    expect(screen.getByText('Pod')).toBeInTheDocument();
    expect(screen.getByText('nginx-abc')).toBeInTheDocument();
  });

  it('renders status pill with custom label', () => {
    render(
      <AIResourceCard
        kind="Pod"
        name="nginx"
        status="error"
        statusLabel="CrashLoopBackOff"
      />,
    );
    expect(screen.getByText('CrashLoopBackOff')).toBeInTheDocument();
  });

  it('renders status pill with default label', () => {
    render(<AIResourceCard kind="Pod" name="nginx" status="healthy" />);
    expect(screen.getByText('healthy')).toBeInTheDocument();
  });

  it('renders scope with custom label', () => {
    render(
      <AIResourceCard
        kind="EC2 Instance"
        name="i-abc123"
        scope="us-east-1"
        scopeLabel="Region"
      />,
    );
    expect(screen.getByText('Region:')).toBeInTheDocument();
    expect(screen.getByText('us-east-1')).toBeInTheDocument();
  });

  it('renders metadata rows', () => {
    render(
      <AIResourceCard
        kind="Pod"
        name="nginx"
        metadata={[
          { label: 'Node', value: 'worker-1' },
          { label: 'Restarts', value: '5' },
        ]}
      />,
    );
    expect(screen.getByText('Node:')).toBeInTheDocument();
    expect(screen.getByText('worker-1')).toBeInTheDocument();
    expect(screen.getByText('Restarts:')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('calls onNavigate when View button is clicked', () => {
    const handleNav = vi.fn();
    render(
      <AIResourceCard kind="Pod" name="nginx" onNavigate={handleNav} />,
    );
    fireEvent.click(screen.getByLabelText('View resource'));
    expect(handleNav).toHaveBeenCalledOnce();
  });

  it('renders compact mode as a chip', () => {
    render(<AIResourceCard kind="Pod" name="nginx" compact />);
    expect(screen.getByText('Pod/nginx')).toBeInTheDocument();
  });

  it('compact mode is clickable when onNavigate provided', () => {
    const handleNav = vi.fn();
    render(
      <AIResourceCard kind="Pod" name="nginx" compact onNavigate={handleNav} />,
    );
    fireEvent.click(screen.getByText('Pod/nginx'));
    expect(handleNav).toHaveBeenCalledOnce();
  });
});
