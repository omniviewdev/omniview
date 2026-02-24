import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import type { RuntimeClass, Scheduling } from 'kubernetes-types/node/v1';
import type { DrawerContext } from '@omniviewdev/runtime';

// ---------------------------------------------------------------------------
// Mocks — lightweight pass-through stubs for UI primitives
// ---------------------------------------------------------------------------

vi.mock('@omniviewdev/ui', () => ({
  Chip: ({ children, color, variant }: any) => (
    <span data-testid="chip" data-color={color} data-variant={variant}>{children}</span>
  ),
  Card: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@omniviewdev/ui/layout', () => ({
  Stack: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@omniviewdev/ui/typography', () => ({
  Text: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('../../../../../shared/KVCard', () => ({
  default: ({ title, kvs }: any) => (
    <div data-testid="kv-card" data-title={title}>
      {Object.entries(kvs).map(([k, v]) => (
        <span key={k}>{k}={v as string}</span>
      ))}
    </div>
  ),
}));

vi.mock('../../../../../shared/sidebar/pages/overview/sections/MetadataSection', () => ({
  default: ({ data }: any) => (
    <div data-testid="metadata-section" data-name={data?.name} />
  ),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import RuntimeClassHandlerSection from './RuntimeClassHandlerSection';
import RuntimeClassSchedulingSection from './RuntimeClassSchedulingSection';
import RuntimeClassSidebar from './index';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRuntimeClass(overrides: Partial<RuntimeClass> = {}): RuntimeClass {
  return {
    apiVersion: 'node.k8s.io/v1',
    kind: 'RuntimeClass',
    metadata: { name: 'gvisor', uid: 'abc-123' },
    handler: 'runsc',
    ...overrides,
  };
}

function makeDrawerCtx(
  data: RuntimeClass | undefined,
): DrawerContext<RuntimeClass> {
  return {
    data,
    resource: { connectionID: 'conn-1', id: 'gvisor' },
  } as DrawerContext<RuntimeClass>;
}

// ---------------------------------------------------------------------------
// RuntimeClassHandlerSection
// ---------------------------------------------------------------------------

describe('RuntimeClassHandlerSection', () => {
  it('renders handler name in a chip', () => {
    render(<RuntimeClassHandlerSection data={makeRuntimeClass()} />);
    expect(screen.getByText('Runtime')).toBeInTheDocument();
    expect(screen.getByText('runsc')).toBeInTheDocument();
  });

  it('shows dash when handler is undefined', () => {
    render(<RuntimeClassHandlerSection data={makeRuntimeClass({ handler: undefined as any })} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders CPU and memory overhead when present', () => {
    const rc = makeRuntimeClass({
      overhead: { podFixed: { cpu: '250m', memory: '120Mi' } },
    });
    render(<RuntimeClassHandlerSection data={rc} />);
    expect(screen.getByText('CPU Overhead')).toBeInTheDocument();
    expect(screen.getByText('250m')).toBeInTheDocument();
    expect(screen.getByText('Memory Overhead')).toBeInTheDocument();
    expect(screen.getByText('120Mi')).toBeInTheDocument();
  });

  it('hides overhead section when overhead is absent', () => {
    render(<RuntimeClassHandlerSection data={makeRuntimeClass()} />);
    expect(screen.queryByText('CPU Overhead')).not.toBeInTheDocument();
    expect(screen.queryByText('Memory Overhead')).not.toBeInTheDocument();
  });

  it('hides overhead section when podFixed is empty', () => {
    const rc = makeRuntimeClass({ overhead: { podFixed: {} } });
    render(<RuntimeClassHandlerSection data={rc} />);
    expect(screen.queryByText('CPU Overhead')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// RuntimeClassSchedulingSection
// ---------------------------------------------------------------------------

describe('RuntimeClassSchedulingSection', () => {
  it('returns null when no nodeSelector and no tolerations', () => {
    const { container } = render(
      <RuntimeClassSchedulingSection scheduling={{}} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders KVCard for nodeSelector', () => {
    const scheduling: Scheduling = {
      nodeSelector: { 'runtime.class': 'gvisor', zone: 'us-east-1a' },
    };
    render(<RuntimeClassSchedulingSection scheduling={scheduling} />);
    const card = screen.getByTestId('kv-card');
    expect(card).toHaveAttribute('data-title', 'Node Selector');
    expect(screen.getByText('runtime.class=gvisor')).toBeInTheDocument();
    expect(screen.getByText('zone=us-east-1a')).toBeInTheDocument();
  });

  it('renders tolerations with key, operator, effect', () => {
    const scheduling: Scheduling = {
      tolerations: [
        { key: 'dedicated', operator: 'Equal', value: 'sandbox', effect: 'NoSchedule' },
      ],
    };
    render(<RuntimeClassSchedulingSection scheduling={scheduling} />);
    expect(screen.getByText('Tolerations')).toBeInTheDocument();
    expect(screen.getByText('dedicated')).toBeInTheDocument();
    expect(screen.getByText('= sandbox')).toBeInTheDocument();
    expect(screen.getByText('NoSchedule')).toBeInTheDocument();
  });

  it('shows "Exists" for Exists operator', () => {
    const scheduling: Scheduling = {
      tolerations: [
        { key: 'node.kubernetes.io/not-ready', operator: 'Exists', effect: 'NoExecute' },
      ],
    };
    render(<RuntimeClassSchedulingSection scheduling={scheduling} />);
    expect(screen.getByText('Exists')).toBeInTheDocument();
    expect(screen.getByText('NoExecute')).toBeInTheDocument();
  });

  it('shows wildcard * for empty key', () => {
    const scheduling: Scheduling = {
      tolerations: [{ key: '', operator: 'Exists' }],
    };
    render(<RuntimeClassSchedulingSection scheduling={scheduling} />);
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('shows tolerationSeconds when present', () => {
    const scheduling: Scheduling = {
      tolerations: [
        { key: 'node.kubernetes.io/unreachable', operator: 'Exists', effect: 'NoExecute', tolerationSeconds: 300 },
      ],
    };
    render(<RuntimeClassSchedulingSection scheduling={scheduling} />);
    expect(screen.getByText('300s')).toBeInTheDocument();
  });

  it('displays count chip for tolerations', () => {
    const scheduling: Scheduling = {
      tolerations: [
        { key: 'a', operator: 'Exists', effect: 'NoSchedule' },
        { key: 'b', operator: 'Exists', effect: 'NoExecute' },
      ],
    };
    render(<RuntimeClassSchedulingSection scheduling={scheduling} />);
    // The count chip should show 2
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders both nodeSelector and tolerations together', () => {
    const scheduling: Scheduling = {
      nodeSelector: { tier: 'sandbox' },
      tolerations: [
        { key: 'sandbox', operator: 'Equal', value: 'true', effect: 'NoSchedule' },
      ],
    };
    render(<RuntimeClassSchedulingSection scheduling={scheduling} />);
    expect(screen.getByTestId('kv-card')).toBeInTheDocument();
    expect(screen.getByText('Tolerations')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// RuntimeClassSidebar (composed)
// ---------------------------------------------------------------------------

describe('RuntimeClassSidebar', () => {
  it('returns null when ctx.data is undefined', () => {
    const { container } = render(
      <RuntimeClassSidebar ctx={makeDrawerCtx(undefined)} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders MetadataSection with correct data', () => {
    const rc = makeRuntimeClass();
    render(<RuntimeClassSidebar ctx={makeDrawerCtx(rc)} />);
    const meta = screen.getByTestId('metadata-section');
    expect(meta).toHaveAttribute('data-name', 'gvisor');
  });

  it('renders handler section', () => {
    const rc = makeRuntimeClass();
    render(<RuntimeClassSidebar ctx={makeDrawerCtx(rc)} />);
    expect(screen.getByText('Runtime')).toBeInTheDocument();
    expect(screen.getByText('runsc')).toBeInTheDocument();
  });

  it('renders scheduling section when scheduling is present', () => {
    const rc = makeRuntimeClass({
      scheduling: {
        nodeSelector: { runtime: 'gvisor' },
        tolerations: [
          { key: 'sandbox', operator: 'Exists', effect: 'NoSchedule' },
        ],
      },
    });
    render(<RuntimeClassSidebar ctx={makeDrawerCtx(rc)} />);
    expect(screen.getByTestId('kv-card')).toBeInTheDocument();
    expect(screen.getByText('Tolerations')).toBeInTheDocument();
  });

  it('omits scheduling section when scheduling is absent', () => {
    const rc = makeRuntimeClass();
    render(<RuntimeClassSidebar ctx={makeDrawerCtx(rc)} />);
    expect(screen.queryByText('Tolerations')).not.toBeInTheDocument();
    expect(screen.queryByTestId('kv-card')).not.toBeInTheDocument();
  });

  it('renders full sidebar with overhead + scheduling', () => {
    const rc = makeRuntimeClass({
      overhead: { podFixed: { cpu: '100m', memory: '64Mi' } },
      scheduling: {
        tolerations: [
          { key: 'runtime', operator: 'Equal', value: 'gvisor', effect: 'NoSchedule' },
        ],
      },
    });
    render(<RuntimeClassSidebar ctx={makeDrawerCtx(rc)} />);
    // Handler section
    expect(screen.getByText('runsc')).toBeInTheDocument();
    expect(screen.getByText('100m')).toBeInTheDocument();
    expect(screen.getByText('64Mi')).toBeInTheDocument();
    // Scheduling section
    expect(screen.getByText('runtime')).toBeInTheDocument();
    expect(screen.getByText('NoSchedule')).toBeInTheDocument();
  });
});
