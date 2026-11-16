import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';

afterEach(cleanup);

describe('ui-next App', () => {
  it('renders the single ui-next screen', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'Omniview ui-next' })).toBeInTheDocument();
  });
});
