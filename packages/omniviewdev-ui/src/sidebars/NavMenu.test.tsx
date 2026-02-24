import { render, screen, fireEvent } from '@testing-library/react';
import NavMenu, { findAncestors } from './NavMenu';
import type { NavSection } from './types';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const simpleSections: NavSection[] = [
  {
    title: 'Resources',
    items: [
      { id: 'dashboard', label: 'Dashboard' },
      {
        id: 'workload',
        label: 'Workload',
        children: [
          { id: 'pods', label: 'Pods' },
          { id: 'deployments', label: 'Deployments' },
        ],
      },
      {
        id: 'network',
        label: 'Networking',
        children: [
          { id: 'services', label: 'Services' },
          { id: 'ingresses', label: 'Ingresses' },
        ],
      },
    ],
  },
];

const nestedSections: NavSection[] = [
  {
    title: '',
    items: [
      {
        id: 'compute',
        label: 'Compute',
        children: [
          {
            id: 'ec2',
            label: 'EC2',
            children: [
              {
                id: 'ec2__instances',
                label: 'Instances',
                children: [
                  { id: 'ec2_v1_Instance', label: 'Instance' },
                ],
              },
            ],
          },
          { id: 'lambda', label: 'Lambda', children: [{ id: 'lambda_v1_Function', label: 'Functions' }] },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// findAncestors — pure function tests
// ---------------------------------------------------------------------------

describe('findAncestors', () => {
  it('returns empty array for a top-level leaf item', () => {
    expect(findAncestors(simpleSections, 'dashboard')).toEqual([]);
  });

  it('returns parent ID for a direct child', () => {
    expect(findAncestors(simpleSections, 'pods')).toEqual(['workload']);
  });

  it('returns full ancestor chain for deeply nested item', () => {
    expect(findAncestors(nestedSections, 'ec2_v1_Instance')).toEqual([
      'compute',
      'ec2',
      'ec2__instances',
    ]);
  });

  it('returns empty array when target is not found', () => {
    expect(findAncestors(simpleSections, 'nonexistent')).toEqual([]);
  });

  it('returns correct ancestors for item in second branch', () => {
    expect(findAncestors(nestedSections, 'lambda_v1_Function')).toEqual([
      'compute',
      'lambda',
    ]);
  });

  it('returns empty array for a group item itself (it is not nested under a parent)', () => {
    expect(findAncestors(simpleSections, 'workload')).toEqual([]);
  });

  it('handles multiple sections correctly', () => {
    const multi: NavSection[] = [
      { title: 'A', items: [{ id: 'a1', label: 'A1', children: [{ id: 'a1c', label: 'A1C' }] }] },
      { title: 'B', items: [{ id: 'b1', label: 'B1', children: [{ id: 'b1c', label: 'B1C' }] }] },
    ];
    expect(findAncestors(multi, 'b1c')).toEqual(['b1']);
    // Ensure searching section A didn't leak state into section B's result
    expect(findAncestors(multi, 'a1c')).toEqual(['a1']);
  });
});

// ---------------------------------------------------------------------------
// NavMenu component tests
// ---------------------------------------------------------------------------

describe('NavMenu', () => {
  describe('default collapsed behavior', () => {
    it('renders group items collapsed by default (children not visible)', () => {
      render(<NavMenu sections={simpleSections} />);
      // Group labels should be visible
      expect(screen.getByText('Workload')).toBeInTheDocument();
      expect(screen.getByText('Networking')).toBeInTheDocument();
      // Child items should NOT be visible since groups are collapsed
      expect(screen.queryByText('Pods')).not.toBeInTheDocument();
      expect(screen.queryByText('Services')).not.toBeInTheDocument();
    });

    it('renders all items expanded when defaultExpanded=true', () => {
      render(<NavMenu sections={simpleSections} defaultExpanded />);
      expect(screen.getByText('Pods')).toBeInTheDocument();
      expect(screen.getByText('Services')).toBeInTheDocument();
    });
  });

  describe('expand/collapse toggle', () => {
    it('expands a group when clicked and collapses it when clicked again', () => {
      render(<NavMenu sections={simpleSections} animate={false} />);
      // Initially collapsed
      expect(screen.queryByText('Pods')).not.toBeInTheDocument();
      // Click to expand
      fireEvent.click(screen.getByText('Workload'));
      expect(screen.getByText('Pods')).toBeInTheDocument();
      expect(screen.getByText('Deployments')).toBeInTheDocument();
      // Click again to collapse
      fireEvent.click(screen.getByText('Workload'));
      expect(screen.queryByText('Pods')).not.toBeInTheDocument();
    });
  });

  describe('onExpandedChange callback', () => {
    it('fires when a group is toggled', () => {
      const onChange = jest.fn();
      render(
        <NavMenu sections={simpleSections} animate={false} onExpandedChange={onChange} />,
      );
      fireEvent.click(screen.getByText('Workload'));
      expect(onChange).toHaveBeenCalledTimes(1);
      const state = onChange.mock.calls[0][0];
      expect(state['workload']).toBe(true);
    });

    it('fires with updated state on collapse', () => {
      const onChange = jest.fn();
      render(
        <NavMenu
          sections={simpleSections}
          animate={false}
          initialExpandedState={{ workload: true }}
          onExpandedChange={onChange}
        />,
      );
      // workload is initially expanded via initialExpandedState
      expect(screen.getByText('Pods')).toBeInTheDocument();
      // Collapse it
      fireEvent.click(screen.getByText('Workload'));
      const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
      expect(lastCall['workload']).toBe(false);
    });
  });

  describe('initialExpandedState', () => {
    it('expands only items specified in initialExpandedState', () => {
      render(
        <NavMenu
          sections={simpleSections}
          animate={false}
          initialExpandedState={{ workload: true }}
        />,
      );
      // Workload children visible
      expect(screen.getByText('Pods')).toBeInTheDocument();
      // Network children NOT visible
      expect(screen.queryByText('Services')).not.toBeInTheDocument();
    });
  });

  describe('auto-expand on selection', () => {
    it('expands ancestors when a nested item is selected', () => {
      const { rerender } = render(
        <NavMenu sections={simpleSections} animate={false} />,
      );
      // Initially all collapsed
      expect(screen.queryByText('Pods')).not.toBeInTheDocument();

      // Select a child item — workload group should auto-expand
      rerender(
        <NavMenu sections={simpleSections} animate={false} selected="pods" />,
      );
      expect(screen.getByText('Pods')).toBeInTheDocument();
      // Other group should remain collapsed
      expect(screen.queryByText('Services')).not.toBeInTheDocument();
    });

    it('expands deeply nested ancestors', () => {
      render(
        <NavMenu sections={nestedSections} animate={false} selected="ec2_v1_Instance" />,
      );
      // All ancestors should be expanded
      expect(screen.getByText('EC2')).toBeInTheDocument();
      expect(screen.getByText('Instances')).toBeInTheDocument();
      expect(screen.getByText('Instance')).toBeInTheDocument();
    });

    it('fires onExpandedChange when auto-expanding', () => {
      const onChange = jest.fn();
      render(
        <NavMenu
          sections={simpleSections}
          animate={false}
          selected="pods"
          onExpandedChange={onChange}
        />,
      );
      // Should have fired with workload expanded
      expect(onChange).toHaveBeenCalled();
      const lastState = onChange.mock.calls[onChange.mock.calls.length - 1][0];
      expect(lastState['workload']).toBe(true);
    });
  });

  describe('animate prop', () => {
    it('does not render MUI Collapse when animate=false', () => {
      const { container } = render(
        <NavMenu
          sections={simpleSections}
          animate={false}
          initialExpandedState={{ workload: true }}
        />,
      );
      // MUI Collapse adds a wrapper div with MuiCollapse class
      expect(container.querySelector('.MuiCollapse-root')).toBeNull();
      // But children should still be visible
      expect(screen.getByText('Pods')).toBeInTheDocument();
    });

    it('renders MUI Collapse when animate=true (default)', () => {
      const { container } = render(
        <NavMenu
          sections={simpleSections}
          defaultExpanded
        />,
      );
      // MUI Collapse should be present
      expect(container.querySelector('.MuiCollapse-root')).not.toBeNull();
    });
  });

  describe('leaf item selection', () => {
    it('calls onSelect when a leaf item is clicked', () => {
      const onSelect = jest.fn();
      render(
        <NavMenu
          sections={simpleSections}
          animate={false}
          initialExpandedState={{ workload: true }}
          onSelect={onSelect}
        />,
      );
      fireEvent.click(screen.getByText('Pods'));
      expect(onSelect).toHaveBeenCalledWith('pods');
    });

    it('does not call onSelect when a group item is clicked', () => {
      const onSelect = jest.fn();
      render(
        <NavMenu sections={simpleSections} animate={false} onSelect={onSelect} />,
      );
      fireEvent.click(screen.getByText('Workload'));
      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  describe('section merge on async data load', () => {
    it('preserves user-expanded state when sections update with new items', () => {
      const onChange = jest.fn();
      const initialSections: NavSection[] = [
        {
          title: '',
          items: [
            { id: 'workload', label: 'Workload', children: [{ id: 'pods', label: 'Pods' }] },
          ],
        },
      ];

      const { rerender } = render(
        <NavMenu
          sections={initialSections}
          animate={false}
          onExpandedChange={onChange}
        />,
      );

      // User expands workload
      fireEvent.click(screen.getByText('Workload'));
      expect(screen.getByText('Pods')).toBeInTheDocument();

      // Simulate async load adding a new section group
      const updatedSections: NavSection[] = [
        {
          title: '',
          items: [
            { id: 'workload', label: 'Workload', children: [{ id: 'pods', label: 'Pods' }] },
            { id: 'network', label: 'Networking', children: [{ id: 'services', label: 'Services' }] },
          ],
        },
      ];

      rerender(
        <NavMenu
          sections={updatedSections}
          animate={false}
          onExpandedChange={onChange}
        />,
      );

      // Workload should STILL be expanded (user's state preserved)
      expect(screen.getByText('Pods')).toBeInTheDocument();
      // New group should be collapsed (default)
      expect(screen.queryByText('Services')).not.toBeInTheDocument();
    });
  });

  describe('item with defaultExpanded on NavMenuItem', () => {
    it('respects per-item defaultExpanded when menu defaultExpanded is false', () => {
      const sections: NavSection[] = [
        {
          title: '',
          items: [
            { id: 'workload', label: 'Workload', defaultExpanded: true, children: [{ id: 'pods', label: 'Pods' }] },
            { id: 'network', label: 'Networking', children: [{ id: 'services', label: 'Services' }] },
          ],
        },
      ];
      render(<NavMenu sections={sections} animate={false} />);
      // Workload has defaultExpanded=true, should be open
      expect(screen.getByText('Pods')).toBeInTheDocument();
      // Network has no defaultExpanded, should be closed
      expect(screen.queryByText('Services')).not.toBeInTheDocument();
    });
  });
});
