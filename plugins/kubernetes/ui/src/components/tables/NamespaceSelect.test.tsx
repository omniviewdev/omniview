import { render, screen, fireEvent } from '@testing-library/react';
import NamespaceSelect from './NamespaceSelect';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let mockNamespaces: string[] = [];

vi.mock('@omniviewdev/runtime', () => ({
  useResources: () => ({
    resources: {
      data: {
        result: mockNamespaces.map((name) => ({ metadata: { name } })),
      },
    },
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderNs(
  selected: string[] = [],
  setNamespaces = vi.fn(),
) {
  const utils = render(
    <NamespaceSelect
      connectionID="c1"
      selected={selected}
      setNamespaces={setNamespaces}
    />,
  );
  return { ...utils, setNamespaces };
}

/** Query all MUI Chip delete icons in the document */
const getDeleteIcons = () =>
  document.querySelectorAll<HTMLElement>('.MuiChip-deleteIcon');

/** Query the clear-all button via its aria-label */
const getClearAllButton = () =>
  screen.queryByLabelText('Clear all');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NamespaceSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNamespaces = ['default', 'kube-system', 'monitoring', 'production'];
  });

  // --- Rendering ---

  it('shows "All Namespaces" placeholder when none selected', () => {
    renderNs([]);
    expect(screen.getByText('All Namespaces')).toBeInTheDocument();
  });

  it('shows selected namespace chips', () => {
    renderNs(['default', 'kube-system']);
    expect(screen.getByText('default')).toBeInTheDocument();
    expect(screen.getByText('kube-system')).toBeInTheDocument();
  });

  // --- Chip delete (clearable) ---

  it('renders delete buttons on each chip', () => {
    renderNs(['default', 'kube-system']);
    expect(getDeleteIcons().length).toBe(2);
  });

  it('clicking first chip delete removes that namespace', () => {
    const setNamespaces = vi.fn();
    renderNs(['default', 'kube-system'], setNamespaces);

    fireEvent.click(getDeleteIcons()[0]);
    expect(setNamespaces).toHaveBeenCalledWith(['kube-system']);
  });

  it('clicking second chip delete removes that namespace', () => {
    const setNamespaces = vi.fn();
    renderNs(['default', 'kube-system'], setNamespaces);

    fireEvent.click(getDeleteIcons()[1]);
    expect(setNamespaces).toHaveBeenCalledWith(['default']);
  });

  // --- Clear-all ---

  it('shows clear-all icon when more than one namespace selected', () => {
    renderNs(['default', 'kube-system']);
    expect(getClearAllButton()).toBeInTheDocument();
  });

  it('does not show clear-all icon when only one namespace selected', () => {
    renderNs(['default']);
    expect(getClearAllButton()).not.toBeInTheDocument();
  });

  it('does not show clear-all icon when none selected', () => {
    renderNs([]);
    expect(getClearAllButton()).not.toBeInTheDocument();
  });

  it('clicking clear-all removes all namespaces', () => {
    const setNamespaces = vi.fn();
    renderNs(['default', 'kube-system'], setNamespaces);

    fireEvent.mouseDown(getClearAllButton()!);
    expect(setNamespaces).toHaveBeenCalledWith([]);
  });

  // --- Stale / deleted namespaces ---

  it('displays a stale namespace that no longer exists in the cluster', () => {
    // "deleted-ns" is in selected but NOT in mockNamespaces
    renderNs(['default', 'deleted-ns']);

    expect(screen.getByText('default')).toBeInTheDocument();
    expect(screen.getByText('deleted-ns')).toBeInTheDocument();
  });

  it('can remove a stale namespace via chip delete', () => {
    const setNamespaces = vi.fn();
    renderNs(['default', 'deleted-ns'], setNamespaces);

    // Second chip is "deleted-ns"
    fireEvent.click(getDeleteIcons()[1]);
    expect(setNamespaces).toHaveBeenCalledWith(['default']);
  });

  it('can clear-all including stale namespaces', () => {
    const setNamespaces = vi.fn();
    renderNs(['default', 'deleted-ns', 'also-gone'], setNamespaces);

    fireEvent.mouseDown(getClearAllButton()!);
    expect(setNamespaces).toHaveBeenCalledWith([]);
  });
});
