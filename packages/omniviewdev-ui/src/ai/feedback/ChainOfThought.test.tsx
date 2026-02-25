import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChainOfThought, { ChainOfThoughtStep } from './ChainOfThought';

describe('ChainOfThought', () => {
  it('renders all step labels', () => {
    render(
      <ChainOfThought>
        <ChainOfThoughtStep label="Parse input" status="complete" />
        <ChainOfThoughtStep label="Search index" status="active" />
        <ChainOfThoughtStep label="Generate output" status="pending" />
      </ChainOfThought>,
    );
    expect(screen.getByText('Parse input')).toBeInTheDocument();
    expect(screen.getByText('Search index')).toBeInTheDocument();
    expect(screen.getByText('Generate output')).toBeInTheDocument();
  });

  it('complete status shows check icon', () => {
    render(
      <ChainOfThought>
        <ChainOfThoughtStep label="Done step" status="complete" />
      </ChainOfThought>,
    );
    expect(screen.getByTestId('CheckCircleIcon')).toBeInTheDocument();
  });

  it('active status shows spinner', () => {
    render(
      <ChainOfThought>
        <ChainOfThoughtStep label="Active step" status="active" />
      </ChainOfThought>,
    );
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('pending status shows pending icon', () => {
    render(
      <ChainOfThought>
        <ChainOfThoughtStep label="Pending step" status="pending" />
      </ChainOfThought>,
    );
    expect(screen.getByTestId('PendingIcon')).toBeInTheDocument();
  });

  it('error status shows error icon', () => {
    render(
      <ChainOfThought>
        <ChainOfThoughtStep label="Failed step" status="error" />
      </ChainOfThought>,
    );
    expect(screen.getByTestId('ErrorIcon')).toBeInTheDocument();
  });

  it('step with children: click toggles expand/collapse', () => {
    render(
      <ChainOfThought>
        <ChainOfThoughtStep label="Expandable" status="complete">
          <div>Details here</div>
        </ChainOfThoughtStep>
      </ChainOfThought>,
    );
    // complete steps start collapsed (only active starts expanded)
    expect(screen.queryByText('Details here')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Expandable'));
    expect(screen.getByText('Details here')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Expandable'));
    expect(screen.queryByText('Details here')).not.toBeInTheDocument();
  });

  it('active step with children starts expanded', () => {
    render(
      <ChainOfThought>
        <ChainOfThoughtStep label="Active" status="active">
          <div>Active details</div>
        </ChainOfThoughtStep>
      </ChainOfThought>,
    );
    expect(screen.getByText('Active details')).toBeInTheDocument();
  });
});
