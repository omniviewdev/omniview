import { Component, type ErrorInfo, type ReactNode } from 'react';

type BoundaryProps = {
  /** What the boundary contains, for the log: "<plugin> page items". */
  readonly name: string;
  /** What to draw instead of the children once one of them threw, and how to try them again. */
  readonly fallback: (retry: () => void, error: Error) => ReactNode;
  /** The boundary tries its children again when this changes: the route moved to another page. */
  readonly resetKey?: string | undefined;
  readonly children: ReactNode;
};

type BoundaryState = { readonly error: Error | undefined };

/**
 * One contribution's error boundary: a hook, a cell or a sidebar that throws while rendering takes down what the boundary holds and nothing around
 * it. It catches render and lifecycle errors, as every boundary does; an error in an event handler or an async callback is the plugin's to handle.
 * The old shell wraps every contribution the same way (ui/features/plugins/README.md, "Error Isolation").
 */
export class ContributionBoundary extends Component<BoundaryProps, BoundaryState> {
  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  state: BoundaryState = { error: undefined };

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[plugins] ${this.props.name} failed to render`, error, info.componentStack);
  }

  componentDidUpdate(before: BoundaryProps): void {
    if (this.state.error !== undefined && before.resetKey !== this.props.resetKey) {
      this.retry();
    }
  }

  retry = (): void => {
    this.setState({ error: undefined });
  };

  render(): ReactNode {
    return this.state.error === undefined ? this.props.children : this.props.fallback(this.retry, this.state.error);
  }
}
