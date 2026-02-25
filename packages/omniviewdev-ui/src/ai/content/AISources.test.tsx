import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AISources from './AISources';

describe('AISources', () => {
  const sources = [
    { title: 'K8s Docs', url: 'https://kubernetes.io', description: 'Official docs' },
    { title: 'Blog Post' },
  ];

  it('renders list of sources with numbers', () => {
    render(<AISources sources={sources} />);
    expect(screen.getByText('1.')).toBeInTheDocument();
    expect(screen.getByText('2.')).toBeInTheDocument();
  });

  it('shows title for each source', () => {
    render(<AISources sources={sources} />);
    expect(screen.getByText('K8s Docs')).toBeInTheDocument();
    expect(screen.getByText('Blog Post')).toBeInTheDocument();
  });

  it('shows description when provided', () => {
    render(<AISources sources={sources} />);
    expect(screen.getByText('Official docs')).toBeInTheDocument();
  });

  it('links have correct href', () => {
    render(<AISources sources={sources} />);
    const link = screen.getByRole('link', { name: /K8s Docs/ });
    expect(link).toHaveAttribute('href', 'https://kubernetes.io');
  });

  it('returns null for empty sources', () => {
    const { container } = render(<AISources sources={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
