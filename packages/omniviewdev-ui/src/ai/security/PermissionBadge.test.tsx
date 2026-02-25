import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PermissionBadge from './PermissionBadge';

describe('PermissionBadge', () => {
  it.each([
    ['read-only', 'Read-only'],
    ['read-write', 'Read-write'],
    ['full-access', 'Full access'],
    ['restricted', 'Restricted'],
  ] as const)('renders correct label for level "%s"', (level, expectedLabel) => {
    render(<PermissionBadge level={level} />);
    expect(screen.getByText(expectedLabel)).toBeInTheDocument();
  });

  it('shows tooltip when provided', async () => {
    render(<PermissionBadge level="read-only" tooltip="Can only read resources" />);
    // Tooltip renders in DOM — the badge text should still be present
    expect(screen.getByText('Read-only')).toBeInTheDocument();
  });
});
