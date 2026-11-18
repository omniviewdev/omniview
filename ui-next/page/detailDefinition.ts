import type {
  DataTableColumn,
  IconName,
  KeyValueRow,
  KindTileTone,
  ListRow,
  PageHeaderCommands,
  PageHeaderFact,
  PageHeaderState,
  PageOperation,
  StatusSummaryItem,
  TagItem,
} from '@omniviewdev/kit';
import type { ReactNode } from 'react';

// What a detail page is, and what feeds it. Plain data and one function per question, as the list page's (`definition.ts`): the page is a pure function of
// `(definition, params, source)`, the source a prop and never a hook the definition calls, so the page reads no data layer and knows no plugin. The design is the mock's page-kit
// detail composition (page header, in-page tabs, an Overview of sections: design 12 PH1 to PH3, FS1, KV1; design 13 OVW1).

/** How a route names an object: which of its parameters are the name, and which tell two objects of one name apart. Every parameter is a string. */
export type DetailIdentity = {
  /** The parameter that holds the object's name: the page's heading, and the first part of the tab's title (`{name} · {Kind}`, design 16 TI1). */
  readonly name: string;
  /** The parameters that qualify the name, most to least preferred (a group, an owner): from them the shell builds the shortest qualifier that tells two tabs of one name apart. A parameter the route lacks is left out. */
  readonly facets?: readonly string[] | undefined;
};

/** One in-page tab. Its label is a noun in the user's words ("Overview"); the first tab of the definition opens first. */
export type DetailTab = {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName | undefined;
};

export type DetailPageDefinition = {
  /** The kind of object, spelled as the platform spells it ("Item"): the second part of the tab's title and the word of the page's states. */
  readonly kind: string;
  /** The tile of the kind, before the heading: it differs by kind (design 13 GL1). */
  readonly tile: { readonly icon: IconName; readonly tone?: KindTileTone | undefined };
  readonly identity: DetailIdentity;
  /**
   * The list the object is read from: the crumb above it in the back path, and the sidebar entry that stays selected while the object is open. `page` is one of the
   * contribution's pages and `label` the crumb's words ("Items").
   */
  readonly list?: { readonly page: string; readonly label: string } | undefined;
  /** The page's tabs, in order, at least one. The page draws the strip from this before any data is read, so nothing moves when the data arrives. */
  readonly tabs: readonly DetailTab[];
};

/**
 * Where the object is, as the page words it.
 *
 * - `loading`: the object is on its way.
 * - `ready`: the view is the object.
 * - `not-found`: the object does not exist (never did, or was deleted). `message` is the plugin's detail, in the person's words.
 * - `denied`: the person may not read it.
 * - `failed`: a read failed. `retry` is given only when asking again can help; without it the page draws no Retry (a button that does nothing is a stub).
 *
 * A state other than `ready` replaces the body of the page and leaves the header and the strip where they are. A failure that comes after a view does not replace it.
 */
export type DetailState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'not-found'; readonly message?: string | undefined }
  | { readonly kind: 'denied'; readonly message?: string | undefined }
  | { readonly kind: 'failed'; readonly message?: string | undefined; readonly retry?: (() => void) | undefined };

/** Where a section sits: the object's own content in the main column, usage and metadata in the aside (design 13 OVW1). The aside stacks under the main column in a narrow page. */
export type DetailPlacement = 'main' | 'aside';

/** What every section has. A section that has nothing to say is not drawn: never an empty heading, never a placeholder (design 13 OVW1). */
type SectionBase = {
  /** Names the section in its column and keys it. */
  readonly id: string;
  /** The heading, a noun of at most three words ("Details"). */
  readonly title: string;
  /** A muted count after the heading ("3"). */
  readonly count?: number | undefined;
  /** One command at the end of the heading ("View all"). The plugin's callback hears of it. */
  readonly action?: { readonly label: string; readonly icon?: IconName | undefined; readonly onSelect: () => void } | undefined;
  /** The order in its column, lowest first; sections of one priority keep the order they were given in. Default 50. */
  readonly priority?: number | undefined;
};

/** Name and value pairs (design 12 KV1): the object's identity facts. */
export type DetailKvSection = SectionBase & {
  readonly kind: 'kv';
  readonly placement?: DetailPlacement | undefined;
  readonly rows: readonly KeyValueRow[];
  /** Pairs per row, 1 (default) to 3. */
  readonly columns?: 1 | 2 | 3 | undefined;
  readonly labelWidth?: 96 | 130 | 160 | undefined;
};

/**
 * A small table: a bounded first set of what the object holds (its parts, its conditions), with the kit's columns. It is drawn in the main column only: a table in the narrow
 * aside would scroll sideways, so what is listed there is a `list`.
 */
export type DetailTableSection<TRow> = SectionBase & {
  readonly kind: 'table';
  readonly placement?: 'main' | undefined;
  readonly columns: ReadonlyArray<DataTableColumn<TRow>>;
  readonly rows: readonly TRow[];
  readonly getRowKey: (row: TRow) => string;
  /** Lines in a row: 1 (default), or 2 for an identity over a second line. */
  readonly lines?: 1 | 2 | undefined;
};

/** Chips of a key and a value, labels and annotations as one anatomy: open, a bounded first set and "Show all N" for the rest (design 13 OVW1). */
export type DetailTagsSection = SectionBase & {
  readonly kind: 'tags';
  readonly placement?: DetailPlacement | undefined;
  readonly items: readonly TagItem[];
  /** How many show before "Show all N". Default 6. */
  readonly visible?: number | undefined;
};

/** Rows of a title over a muted detail line and a trailing value: what happened lately, what uses the object. */
export type DetailListSection = SectionBase & {
  readonly kind: 'list';
  readonly placement?: DetailPlacement | undefined;
  readonly rows: readonly ListRow[];
};

/**
 * A section of the Overview. A table's rows are of one type the plugin knows and the page does not, so a section of any row type is held under the one erased type here, as a
 * contribution's pages are (`PageV1`): each section is typed with its rows where the plugin writes it (`satisfies DetailTableSection<Row>`).
 */
export type DetailSection = DetailKvSection | DetailTableSection<any> | DetailTagsSection | DetailListSection;

/** What a tab shows. The Overview is typed data the page lays out; any other tab is the plugin's own content, drawn as given. */
export type DetailTabContent =
  | {
    readonly kind: 'overview';
    /** The one line that leads the first screen ("Running · 2/2 ready · up to date": design 12 FS1). */
    readonly summary?: readonly StatusSummaryItem[] | undefined;
    readonly sections: readonly DetailSection[];
  }
  | { readonly kind: 'custom'; readonly content: ReactNode };

/** The object, as the page draws it: the header, the counts of the tabs, and what each tab shows. A function of the object alone. */
export type DetailView = {
  /** The lifecycle state, first in the identity line: the platform's word and its role. */
  readonly state?: PageHeaderState | undefined;
  /** At most four facts after the state (an id, a group, an age). With neither a state nor a fact the kind is the one fact, so the identity line is always there and nothing moves when the object arrives. */
  readonly facts?: readonly PageHeaderFact[] | undefined;
  /** The page's own commands in the one order the design allows (primary, at most two secondary, danger, the overflow menu); the page owns Refresh. A command's `onSelect` is the plugin's callback. */
  readonly commands?: Omit<PageHeaderCommands, 'utility'> | undefined;
  /** The header's operation slot, for an operation of the plugin's own (a restart). Absent: the slot shows the page's own acknowledgements, the Refresh feedback and a failed read. */
  readonly operation?: PageOperation | undefined;
  /** The count after a tab's label, by tab id. */
  readonly counts?: Readonly<Record<string, number>> | undefined;
  /** What each tab shows, by tab id. A tab of the definition that is not here shows nothing. */
  readonly tabs: Readonly<Record<string, DetailTabContent>>;
};

/** What the page lists and what it can ask of it. The page reads it and never writes back. */
export type DetailSource = {
  readonly state: DetailState;
  /** The object: present once `state` is `ready`, and kept while a refresh runs and after a failure that follows it. */
  readonly view: DetailView | undefined;
  /** A refresh runs on a view that stays on screen, whoever asked for it. */
  readonly refreshing: boolean;
  /** The user's Refresh. Resolves when the read is over and never rejects: a failure is the source's `state`. */
  readonly refresh: () => Promise<void>;
};
