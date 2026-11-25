import { ErrorBody, SectionCard } from '@omniviewdev/kit';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import type { DetailSection } from './detailDefinition';

type BoundaryProps = {
  /** The section the boundary holds. A section that cannot be drawn is told by its title and its id, and a section the plugin gives anew is another try. */
  readonly section: DetailSection;
  readonly children: ReactNode;
};

type BoundaryState = {
  readonly error: Error | undefined;
  /** The section `error` is about: when the plugin gives another, the boundary tries it (`getDerivedStateFromProps`). */
  readonly section: DetailSection;
};

/** A plugin's own word for a section, when it is text: the fallback is drawn when the section is NOT what its type says, so it reads nothing else of it. */
const wordOf = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/**
 * One section's error boundary. An Overview is the aggregate of independent reads, and a section is the plugin's data and the plugin's cells: a row, a cell or a section that throws while it draws is that SECTION's failure, so
 * the section's card says so (`<title> failed to display.`, with the kit's failure notice and its Retry) and the page's header, its summary and every other section stay. The page's own boundary, the host's, is for what the page
 * cannot draw at all. It catches render and lifecycle errors, as every boundary does; the error itself goes to the log, never to the page, because its words are the plugin's.
 *
 * Retry draws the section again. So does a section the plugin gives anew (a read that works after one that did not, or the other connection's sections when the connection changes): a failure belongs to the data that caused it,
 * and is not carried to data that is another. The page package knows no plugin and imports none, so this is its own boundary and not the host's `ContributionBoundary`.
 */
export class SectionBoundary extends Component<BoundaryProps, BoundaryState> {
  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    return props.section === state.section ? null : { section: props.section, error: undefined };
  }

  state: BoundaryState = { error: undefined, section: this.props.section };

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[page] section ${wordOf(this.props.section.id) ?? 'with no id'} failed to render`, error, info.componentStack);
  }

  retry = (): void => {
    this.setState({ error: undefined });
  };

  render(): ReactNode {
    if (this.state.error === undefined) {
      return this.props.children;
    }

    const { section } = this.props;
    const title = wordOf(section.title);
    return (
      <SectionCard title={title ?? 'Section'} pad data-detail-section={wordOf(section.id)}>
        <ErrorBody title={`${title ?? 'This section'} failed to display.`} onRetry={this.retry} />
      </SectionCard>
    );
  }
}
