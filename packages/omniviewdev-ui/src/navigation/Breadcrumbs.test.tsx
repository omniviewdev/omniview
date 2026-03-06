import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Breadcrumbs from './Breadcrumbs';

describe('Breadcrumbs', () => {
  it('renders breadcrumb labels', () => {
    render(
      <Breadcrumbs
        items={[
          { label: 'Engine' },
          { label: 'Container' },
          { label: 'Explorer' },
        ]}
      />,
    );

    expect(screen.getByText('Engine')).toBeInTheDocument();
    expect(screen.getByText('Container')).toBeInTheDocument();
    expect(screen.getByText('Explorer')).toBeInTheDocument();
  });

  it('does not render invalid p > div nesting', () => {
    const { container } = render(
      <Breadcrumbs
        items={[
          { label: 'Engine' },
          { label: 'Container' },
          { label: 'Explorer' },
        ]}
      />,
    );

    expect(container.querySelector('p div')).toBeNull();
  });
});
