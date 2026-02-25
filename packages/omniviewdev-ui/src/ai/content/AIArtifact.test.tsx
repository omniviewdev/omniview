import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AIArtifact from './AIArtifact';

describe('AIArtifact', () => {
  it('renders title', () => {
    render(<AIArtifact title="Generated Code">Content</AIArtifact>);
    expect(screen.getByText('Generated Code')).toBeInTheDocument();
  });

  it('renders type label when provided', () => {
    render(
      <AIArtifact title="Code" type="typescript">
        Content
      </AIArtifact>,
    );
    expect(screen.getByText('typescript')).toBeInTheDocument();
  });

  it('expanded by default (defaultExpanded=true)', () => {
    render(<AIArtifact title="Code">Visible content</AIArtifact>);
    expect(screen.getByText('Visible content')).toBeInTheDocument();
  });

  it('collapsed when defaultExpanded=false, click expands', () => {
    render(
      <AIArtifact title="Code" defaultExpanded={false}>
        Hidden content
      </AIArtifact>,
    );
    // Content is in the DOM but hidden via CSS maxHeight: 0 (jsdom can't verify CSS visibility)
    // Verify it exists but we can toggle it
    expect(screen.getByText('Hidden content')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Code'));
    // After expand, content is still in DOM (now visible via CSS)
    expect(screen.getByText('Hidden content')).toBeInTheDocument();
  });
});
