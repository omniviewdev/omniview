# `ui-next/page/`: the list page

The first page of the new shell (slice 1a plan, PR 1a.6): a collection of rows with its page header, quick filters, search, table and count, in one pane. It is **host code and plugin-agnostic**: it knows a screen only by the data the screen states it with, and no plugin word appears in this directory (the vocabulary guard scans it, tests and comments included).

## What a screen gives it

`ListPage` takes two plain values and draws them (`definition.ts` has the types):

| Prop | What | Held by |
|---|---|---|
| `definition` | `title` (the plural name: the heading, the table's name, the word of the states and of Refresh), `nouns` (the count's words), `tile?`, `commands?` (the page's own; Refresh is the page's), `quickFilters?` (a named strip of `{ id, label, tone, test }`), `columns` (the kit's `DataTableColumn`s), `lines` (1 or 2), `getRowKey`, `searchText` (lower case) | type |
| `source` | `state` (`loading`, `ready`, or `failed` with its words and, only when asking again can help, a `retry`), `rows` (already in order; a changed row is a new object), `complete` (the whole set is here), `refreshing`, `refresh()` (resolves when the read is over, never rejects) | type |

The page is a **pure function of `(definition, source)` and what the person typed**: the source is a prop, never a hook the definition calls, so the page reads no data layer. What the person typed (the search, the chosen filter) is the page's own state; what is listed, in what order, and whether it is all of it, is the source's. The page sorts nothing: the source's order is the list's, and the table's own sorting stays off until the sort state exists (plan 1a.7).

## Where a plugin meets it

A plugin's bundle states its page as plain data: a `definition` and one data hook that returns the page's `source` and its frame (`ListPageV1`, `ui-next/plugins/contract/v1.ts`). The host runs the hook and hands both values to `ListPage` and `Shell` in `ui-next/plugins/host/PluginHost.tsx`: **the type checker holds the two shapes together there**, where a drift is a compile error. The page knows no plugin and imports none; its own probe (`probes/`, run by hand) draws it on a neutral fixture.

## What it decides (`view.ts`, pure, tested without a browser)

- The rows: the source's, narrowed by the search (a substring of `searchText`, 500 ms after the last key, at once on Enter or when cleared) and then by the chosen quick filter. A filter chosen twice is cleared; All clears it.
- The counts of the strip are taken **after the search and before the chosen filter**, so choosing one leaves the others' counts as they were. Nothing is counted while nothing is known (a load in progress): a chip with no number, and a zero is a count.
- The body: loading until the first rows or the whole (empty) set arrive; an error, with the one Retry, when a failure left no rows (no footer: the mock draws none); empty when the whole set holds nothing; no-match when rows exist and the query hides them all; ready otherwise. A failure that came after rows does not replace them.
- The footer's count: exact once the set is complete, `N loaded` while it is arriving (decision A10), `K of N` when a search or a filter narrows it.
- Clear filters: one command, in the toolbar, while a search or a filter is applied; it drops both and hands the focus to the search it cleared.

## The user's own Refresh is felt

The Refresh command of the page header (`Refresh <title>`) is unavailable, with its reason as its description, while a refresh runs. The acknowledgement is the header's **operation slot**, not the footer: `Refreshing…` from the click until the read is over and at least 700 ms have passed, then `Updated`, a calm outcome the presenter clears by itself. A refresh nobody asked for is silent, and a failed one is not called an update. Both moments are announced politely through a live region that is in the page from the start.

## Not here (later steps)

Column sorting and the plain connection states (1a.7); selection and the state family `stale`/`partial`/`failure with rows` (1a.8); facets and the Columns chooser, and with them the hidden-columns note (1a.9; errata E6 pending); the detail links of a row, Create and the overflow menu (not 1a).
