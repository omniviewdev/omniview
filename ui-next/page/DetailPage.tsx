import {
  Button,
  DataTable,
  EmptyBody,
  ErrorBody,
  KeyValue,
  ListRows,
  LoadingBody,
  PageHeader,
  SectionCard,
  Stack,
  StatusSummary,
  TabPanel,
  Tabs,
  TagList,
  type PageHeaderCommands,
  type PageOperation,
} from '@omniviewdev/kit';
import { useId, useState } from 'react';
import styles from './DetailPage.module.css';
import type { DetailPageDefinition, DetailSection, DetailSource, DetailTabContent } from './detailDefinition';
import type { RouteParams } from './detailIdentity';
import { deriveDetailModel, overviewColumns, type DetailBody } from './detailView';
import { refreshReason } from './refresh';
import { SectionBoundary } from './SectionBoundary';
import { useRefreshFeedback } from './useRefreshFeedback';

export type DetailPageProps = {
  readonly definition: DetailPageDefinition;
  /** The route's parameters: the object's identity. The page reads the name from them, as the definition says. */
  readonly params: RouteParams;
  readonly source: DetailSource;
};

/** The columns of a loading skeleton: a detail body has no table, so this is only how many bars each row of it holds. */
const SKELETON_COLUMNS = 3;

/** One section of the Overview, in the kit's section card. A kind the page does not know draws nothing (`overviewColumns` has already left it out). */
function SectionView({ section }: { readonly section: DetailSection }) {
  const { action } = section;
  const actions =
    action === undefined ? undefined : (
      <Button variant="ghost" size="compact" icon={action.icon} onClick={action.onSelect}>
        {action.label}
      </Button>
    );
  const meta = section.count === undefined ? undefined : String(section.count);
  switch (section.kind) {
    case 'kv':
      return (
        <SectionCard title={section.title} meta={meta} actions={actions} pad data-detail-section={section.id}>
          <KeyValue rows={section.rows} columns={section.columns} labelWidth={section.labelWidth} />
        </SectionCard>
      );
    case 'table':
      return (
        <SectionCard title={section.title} meta={meta} actions={actions} data-detail-section={section.id}>
          <DataTable label={section.title} rows={section.rows} getRowKey={section.getRowKey} columns={section.columns} lines={section.lines} rowsAreImmutable />
        </SectionCard>
      );
    case 'tags':
      return (
        <SectionCard title={section.title} meta={meta} actions={actions} pad data-detail-section={section.id}>
          <TagList label={section.title} items={section.items} visible={section.visible} />
        </SectionCard>
      );
    case 'list':
      return (
        <SectionCard title={section.title} meta={meta} actions={actions} data-detail-section={section.id}>
          <ListRows label={section.title} rows={section.rows} />
        </SectionCard>
      );
  }

  // A section kind of a later contract never gets here: `overviewColumns` leaves it out.
  return null;
}

/**
 * A section of the Overview in a boundary of its own (S2): what one section's data or cells do while they draw is that section's failure, said in its card, and every other section, the summary and the header stay. Overviews and detail pages
 * share it.
 */
function Section({ section }: { readonly section: DetailSection }) {
  return (
    <SectionBoundary section={section}>
      <SectionView section={section} />
    </SectionBoundary>
  );
}

type OverviewProps = {
  readonly content: Extract<DetailTabContent, { readonly kind: 'overview' }>;
  /** The object's name, for the names of the summary and the aside. */
  readonly name: string;
};

/**
 * The Overview (design 13 OVW1): the one-line summary, then the sections with something to say, the main column's under it and the aside's beside it from 992 px of page width, under
 * it below. A page with no aside is the main column alone.
 */
function Overview({ content, name }: OverviewProps) {
  const { main, aside } = overviewColumns(content.sections);
  const summary = content.summary === undefined || content.summary.length === 0 ? null : <StatusSummary label={`${name} status`} items={content.summary} />;
  const column = (
    <Stack gap={12}>
      {summary}
      {main.map((section) => (
        <Section key={section.id} section={section} />
      ))}
    </Stack>
  );
  if (aside.length === 0) {
    return (
      <div className={styles.single} data-detail-part="overview">
        {column}
      </div>
    );
  }

  return (
    <div className={styles.pair} data-detail-part="overview">
      <div className={styles.main} data-detail-part="main">
        {column}
      </div>
      <div className={styles.aside} data-detail-part="aside" role="group" aria-label="Side sections">
        <Stack gap={12}>
          {aside.map((section) => (
            <Section key={section.id} section={section} />
          ))}
        </Stack>
      </div>
    </div>
  );
}

/** What the panel shows: the state's own words in the kit's state bodies, or the tab's content. */
function Body({ body, name }: { readonly body: DetailBody; readonly name: string }) {
  switch (body.kind) {
    case 'loading':
      return <LoadingBody label={body.label} columns={SKELETON_COLUMNS} />;
    case 'not-found':
      return <EmptyBody title={body.title} hint={body.hint} />;
    case 'denied':
      return <ErrorBody title={body.title} message={body.message} />;
    case 'failed':
      return <ErrorBody title={body.title} message={body.message} onRetry={body.retry} />;
    case 'tab':
      if (body.content === undefined) {
        return null;
      }

      // The plugin's own content, as given: a fragment keeps this a plain component (a node may be a promise in React's types, which only a server component can await).
      return body.content.kind === 'overview' ? <Overview content={body.content} name={name} /> : <>{body.content.content}</>;
  }

  return null;
}

/**
 * The detail page of one object (design 12 PH1 to PH3, FS1; design 13 OVW1): the page header (kind tile, the one h1, the state chip, the facts, the commands in the one order the
 * design allows, the operation slot), the in-page tabs, and the tab's panel. It is a pure function of its definition, its route's parameters and its source: it reads no data layer
 * and knows no plugin. What the person chose (the tab) is the page's own state; what the object is, and whether it is there, is the source's.
 *
 * The header and the strip are drawn from the first frame, from the route and the definition alone, in every state, so the object arriving, or not being there, moves nothing of them:
 * the identity line is always present (a progress word while the object is on its way, the kind when the plugin gives no fact), and the Refresh command is the page's. The user's own
 * Refresh is felt in the header's slot, as the list's is.
 */
export function DetailPage({ definition, params, source }: DetailPageProps) {
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [dismissed, setDismissed] = useState<string | undefined>(undefined);
  const id = useId();
  const model = deriveDetailModel(definition, params, source, { tab: chosen });
  const feedback = useRefreshFeedback({ title: model.heading, refresh: source.refresh, failed: source.state.kind === 'failed' });
  const waiting = model.body.kind === 'loading';

  // A read that failed while the object stays on screen is said in the header's slot, where the page's other acknowledgements go, with the plugin's Retry; it moves nothing below it. It is put
  // away with Dismiss until the failure is another one or has gone: state adjusted while rendering, as React documents for state that follows what it is given.
  const { failure } = model;
  const said = failure === undefined ? undefined : failure.message === undefined ? failure.title : `${failure.title}: ${failure.message}`;
  if (dismissed !== undefined && dismissed !== said) {
    setDismissed(undefined);
  }

  const reported: PageOperation | null =
    failure === undefined || said === undefined || dismissed === said
      ? null
      : {
        title: failure.title,
        state: 'failed',
        text: said,
        actions: failure.retry === undefined ? [] : [{ id: 'retry', label: 'Retry', kind: 'retry', onSelect: failure.retry }],
        onDismiss: () => {
          setDismissed(said);
        },
      };

  const commands: PageHeaderCommands = {
    ...model.commands,
    utility: {
      id: 'refresh',
      label: `Refresh ${model.heading}`,
      icon: 'refresh',
      onSelect: feedback.ask,
      disabledReason: refreshReason(feedback.felt || source.refreshing, waiting),
    },
  };

  return (
    <>
      <div className={styles.top} data-detail-part="header">
        <PageHeader
          title={model.heading}
          tile={definition.tile}
          state={model.state}
          facts={model.facts}
          commands={commands}
          operation={model.operation ?? feedback.operation ?? reported}
        />
      </div>
      <Tabs id={id} label={`${definition.kind} sections`} tabs={model.tabs} selected={model.selected} onSelect={setChosen} />
      <TabPanel id={id} selected={model.selected}>
        <Body body={model.body} name={model.heading} />
      </TabPanel>
      {/* Always in the page, empty at rest: a live region that appears together with its text is not announced. */}
      <span className={styles.live} role="status">
        {feedback.announcement}
      </span>
    </>
  );
}
