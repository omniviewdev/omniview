import type { Guide } from './catalog.ts';

export const entries = {
  DataTable: {
    category: 'Collections',
    summary: 'Compare records in a virtualized native table with sticky headers, predictable row heights, and optional sorting and selection.',
    guidance: [
      'Name the scroll region with label. Use stable getRowKey values and keep the columns array stable across renders.',
      'Use fit="id" for the column that names each record and provide text for sampled widths on id and flex columns. Use lines={2} for a second metadata line.',
      'Own sort and selection in the caller. Use sortKey to make a column sortable, and give each selection checkbox a row-specific name.',
      'Pair onRowActivate with a Link or Button in the row. Row clicks do not add a keyboard tab stop.',
      'Use DataView when the table needs collection states, filters, and a footer. Use ListRows for short summaries that do not need sortable columns.',
    ],
  },
  DataView: {
    category: 'Collections',
    summary: 'Compose a collection workspace with fixed controls and counts around one scrolling results body.',
    guidance: [
      'Use a plural label such as “Jobs.” It names the scroll region and appears in loading, empty, and failure messages.',
      'Use loading for the first load, empty when there is nothing to list, and no-match when filters hide everything. Keep the filter reset in the toolbar.',
      'Use error when a failure leaves no rows. The view announces the failure as an alert, hides the footer, and offers Retry only when you pass onRetry.',
      'Use DataTable directly when the surrounding view already owns controls, counts, and result states.',
    ],
  },
  LogView: {
    category: 'Collections',
    summary: 'Follow a bounded stream of log lines with find, level filtering, and a status strip for stream state and dropped lines.',
    guidance: [
      'Give each session a distinct label and a stable LogFeed with one reader. Replacing the feed starts with an empty buffer.',
      'Set maxLines to the history users need. The view evicts older lines at the cap and reports drops instead of implying the buffer is complete.',
      'Use arrows, Page Up, Page Down, Home, and End to move through the focused list. In find, Enter and Shift+Enter move between matches.',
      'Use createLogViewControls for external follow, pause, clear, and copy commands. Use DataTable for structured records that need sorting instead of tailing.',
    ],
  },
  CollectionFooter: {
    category: 'Collections',
    summary: 'Show the result count, optional selection count, and a note when available width hides columns.',
    guidance: [
      'Pass shown after filtering, with exact for a known whole count, estimate for an approximation, or unknown for a partially loaded collection.',
      'With unknown totals, pass loaded when more items have loaded than are shown. Supply the singular noun and plural explicitly.',
      'Use one footer per collection. Count and selection changes are announced through a status region; keep actions in WorkspaceToolbar.',
      'Pass hiddenColumns only for columns hidden at this width, not columns the user turned off. Offer the hidden columns in the Columns chooser.',
    ],
  },
  ListRows: {
    category: 'Collections',
    summary: 'Present a short list of titles with optional detail, leading glyphs, and aligned trailing metadata.',
    guidance: [
      'Give the list a label such as “Recent warnings” and each row a stable id. The component renders nothing for an empty array.',
      'Keep title and detail brief: both clip to one line. Put an explicit Link in the title for navigation; the row itself is not a control.',
      'Use DataTable for comparable records that need column headers or sorting, or KeyValue for labeled facts about one record.',
    ],
  },
  KindTile: {
    category: 'Collections',
    summary: 'Mark a resource kind with a decorative glyph beside its visible name.',
    guidance: [
      'Map each kind to its icon and tone in the owning view. Use distinct glyphs so kinds do not differ by color alone.',
      'Use the default 20 px box in lists and 16 px in dense trees. Both use the same 16 px glyph.',
      'Keep the kind name in text because the tile is hidden from assistive technology. Use Status for a condition, not KindTile.',
    ],
  },
  QuickFilters: {
    category: 'Collections',
    summary: 'Offer a short, mutually exclusive set of counted filters, with an automatic All option.',
    guidance: [
      'Name the group for what it filters, such as “Job state.” Use user-facing labels for filters and set selected to null for All.',
      'Compute counts in the caller. Omit unknown counts; zero is a real count and leaves the chip muted.',
      'The group takes one tab stop. Left and Right move focus, Home and End jump to the ends, and activation calls onSelect.',
      'Use SearchField for free text or Select for a long list of options. QuickFilters does not apply the filter or change selection itself.',
    ],
  },
  KeyValue: {
    category: 'Collections',
    summary: 'Show labeled facts about one item in a native description list that reflows with its own width.',
    guidance: [
      'Use columns for up to three pairs across and wide for a value that needs the full width. Use mono for IDs or selectors.',
      'Omit unavailable values to get a dash with an accessible name such as “No owner.” Keep explicit values such as 0.',
      'Give a row a stable id if its label can change. The list adds no tab stops; Link and other controls inside values keep their own.',
      'Use DataTable to compare the same fields across records or ListRows for a stream of named items.',
    ],
  },
  WorkspaceToolbar: {
    category: 'Collections',
    summary: 'Arrange search and view commands in one wrapping lane, with an optional trailing group.',
    guidance: [
      'Place search and active filter actions in children. Pass secondary view commands such as Columns to end.',
      'Give the group a purpose-driven label such as “Search and filter jobs.” Name each control too; the group uses ordinary Tab order.',
      'Keep result counts in CollectionFooter. Use QuickFilters for counted state choices, or Stack for a layout without a named command group.',
    ],
  },
  IdentityCell: {
    category: 'Collections',
    summary: 'The identity of a row: a lead, the name, marks, and a muted detail line.',
    guidance: [
      'Use it as the cell of the fit="id" column of a DataTable. A detail line needs lines={2} on the table.',
      'Pass an Avatar or 16 px KindTile as lead. The name gives way with an ellipsis, and its full text is the tooltip while it is cut; the lead and the marks never shrink.',
      'Use to to make the name a Link, which needs a LinkProvider. It is the cell’s only Tab stop.',
      'Each mark is a 12 px glyph with a one-word label, which is its tooltip and accessible name.',
    ],
  },
  ResourceCard: {
    category: 'Collections',
    summary: 'The card for one thing in a collection: identity, up to three facts, and commands.',
    guidance: [
      'Give it a title, an optional lead, a status, and one muted meta line. Add up to three metrics, each with a label and a value.',
      'The card itself is never a control. Use to to make the title a Link, and put commands in actions as sibling buttons, each its own Tab stop.',
      'tone="warning" or "error" colors the border; say the same state in words through status.',
      'Pass menu with the id from useMenu and this card’s key to make it a context trigger. The card registers no menu, and only a title link or action lets the keyboard reach it, so give such a card a to or actions.',
      'Use inside CardGrid so cards in a row match in height. Use DataTable to compare many fields across records.',
    ],
  },
  CardGrid: {
    category: 'Collections',
    summary: 'A responsive grid of cards, optionally in titled groups.',
    guidance: [
      'Pass items or groups, a stable getKey for each item, and a renderCard that returns a ResourceCard. Name the list with label.',
      'Keep item objects and renderCard stable so a change to one item draws one card.',
      'Columns are at least 280 px wide and fill the available width; a narrow box shows one column. Groups are labelled sections with headings; set level to fit the page’s outline.',
      'The grid has no Tab stop or state. It holds the whole collection in the page, so window a collection of thousands instead.',
    ],
  },
} satisfies Record<string, Guide>;
