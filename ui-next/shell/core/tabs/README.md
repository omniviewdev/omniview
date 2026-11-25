# `ui-next/shell/core/tabs/`: the tab and open model

The shell's tabs as plain functions over data (design chapter 16 sections C and D, rules TI1, S24 to S30, S50, S60): where a destination opens, what a tab is called, a tab's own history, close and reopen, pinned and preview, which pages stay mounted, and the saved session. Pure TypeScript: no React, no DOM, no other tree (a test reads every source file and fails on a framework import or a browser global). The shell's strip, page host and status bar read it (`ui-next/shell/tabs/`, status file `docs/ui-next/status/S1b.md`) and the plugin host answers its `Contributions` (`ui-next/plugins/host/contributions.ts`); `types.ts` is the contract and this file is the guide.

## What a tab is

A tab is a route plus restorable state, never DOM (S16). **A route is `{ plugin, contribution, params }`**: a plugin, one of the pages it offers, and that page's plain-JSON parameters. It is canonical (keys in order, an empty member left out) and frozen, and it is what identifies a tab: nothing in the model knows what a parameter means. What a plugin says about a route (`Contributions.describe`) becomes the tab's **face**: title (`{name} · {Kind}`), icon, scope, status path, facets, whether it is a singleton page. The face is cached in the tab and saved with it, so a restored tab draws before its plugin loads.

A tab record is split into the parts that different consumers read: `location` (route, key, generation: the page host), `face` and `flags` (pinned, preview, unsaved, attention: the strip), `history` (at most 50 routes, and what the page of each kept when the tab left it: H7, below), `pageState` (opaque plain data the page on screen keeps, at most 16 KiB), and `reveal` (a request left by an open for the page to answer, never saved).

## The shape plugins will reach through a host hook

```ts
open(destination, { how?, source?, after?, confirmed? }): OpenResult   // smart | here | new | background | window
activate(id) · next() · previous() · goto(n) · last()
close(id?) · detach(id) · closeMany('others' | 'right' | 'left' | 'unpinned') · reopen({ id? }) · duplicate(id?)
navigate(id, destination, { history?: 'push' | 'replace', reuse? }) · replace(id, route)   // replace: an in-page change; reuse: show the tab that already shows the destination
back(id?) · forward(id?) · canBack(id?) · canForward(id?) · historyList(id?, 'back' | 'forward')
```

Every operation answers a plain result (`done`, `noop`, `confirm`, `refused`, and for `open` also `window`), never a string meant for a person and never a promise. **`confirm`** means the request would discard unsaved changes (S27): ask the user, then repeat it with `confirmed: true`. **`window`** means the destination wants a window of its own (S64): the model has none and changes nothing. A `noop` returns the same snapshot object and notifies nobody.

`open` follows ch16 S26 and S64. Smart open (Enter): a singleton page that is open is shown whatever the disposition; else a tab that shows the key is shown; else the tab on screen is navigated when it is the same plugin and scope; else a new tab after the tab on screen (a preview tab when `source` is `search`). `new` never deduplicates, `background` leaves the focus and the result says `focused: false`, `here` navigates the tab on screen. `dispositionOf(event, { platform })` maps modifiers to a disposition.

`navigate` moves the tab it is told to, so by default two tabs may come to show one place, as `new` and `duplicate` let them. A singleton page is the exception (ch16 S26: going to it shows the tab that holds it and the tab stays where it is), and `reuse: true` asks the same of any place another tab already shows: the tab that shows the key is shown (the one on screen first, else the first in the strip), the tab that was asked to move keeps its route, its history and its unsaved changes, and nothing is asked about them. With no other tab on the place it moves as it was told. A change of scope uses it (the host's `switchTab`, `ui-next/plugins/host/connections/actions.ts`: the connection chosen on a tab while another tab already shows that connection's page), so that no two tabs show one place by that way (N4 of the review of HM3b).

## The seam: `Contributions`

The model asks the plugin host (never a plugin) through five pure, synchronous members, each isolated (a throw is reported to `onError` and answered with the value that costs the user least): `describe(route)`, `availability(route)` (S65), `complete(route, { from })` (fills in what a route leaves out from the route the user is on, so a sidebar entry that names no connection takes the tab's), `restore(route)` (rewrite or drop a saved or closed tab), `home()`, and `subscribe(listener)` (what the plugins say changed: the tabs are described again, nothing is notified when nothing is different).

## One snapshot, one slice each

`createTabsStore` returns `getSnapshot()` (an immutable, frozen, JSON-shaped `TabsState` with a `version`) and `subscribe(listener)`, the two functions `useSyncExternalStore` takes, and `subscribeTo(select, listener, equals?)` for a framework-free listener. `store.selectors` holds one selector per consumer; each returns an object that is the same while its slice is the same:

| Consumer | Selector | Changes when |
|---|---|---|
| Tab strip | `strip`, `stripItem(id)`, `identity(id)` | a face, a flag, the order, or a twin's qualifier changes |
| Page host | `mounted`, `location(id)`, `reveal(id)`, `active` | the route, a reload, which pages are mounted, a request |
| Status-bar breadcrumb | `breadcrumb` | the active tab's path or qualifier changes |

A title change in one tab changes what reads that tab and nothing that reads another; `store.test.ts` asserts the object identities. Identity (`Identity`: label, accessible name, tooltip, path) is computed in one place: a tab whose icon and title read like another's gets the shortest qualifier from its facets (the plugin's, then scope, the crumb above the page, the plugin's name). The All tabs list is the strip: the pinned zone always leads, so "pinned first" needs no sort. A strip that is subscribed pays for every change with one pass over the tabs (about 0.03 ms at 500 tabs): what depends on one face is worked out once per face object, and a tab's identity and strip item are made again only when its face, qualifier or flags changed.

## Keep-alive (an open question for the owner)

The old shell mounted a tab on first show and kept it mounted until it closed, with no cap (HSH-21). Here `state.mounted` is the list of tabs whose page is mounted, most recently shown first; a tab enters when it is shown (a restored or background tab has no page), the least recently shown beyond `keepAlive.cap` is evicted, closing a tab or raising the cap brings nothing back, and `selectors.mounted` lists them in strip order. **Default: `{ cap: 5, keepUnsaved: true }`**, one page on screen and four hidden (the number of source views the runtime lets linger, RTM-05); a tab with unsaved changes is never evicted and does not count; `cap: null` is the old policy. This is a placeholder, not a measurement: how many hidden pages, whether a hidden page keeps its effects, and whether pinned tabs are exempt are recorded in `docs/ui-next/status/S1a.md` for the owner. A page host stores its page state with `setPageState` before a page unmounts.

## Saved session

`store.serialise()` gives `{ version, active, tabs }` (route, key, face, pinned, preview, and at most 10 history entries around the current one as routes; no page state, not the page on screen's and none of its history's, and no flag that means "now"). `restoreTabs(raw, { contributions })` reads it back and **repairs rather than discards**: a damaged tab is dropped alone, the pinned zone comes first, one preview and one tab per singleton page are kept, the tab on screen is found again, and only it is mounted. Its answer is `ok` with `repaired` and `problems`, or why not: `missing`, `unreadable`, `foreign-version`, `empty` (the session module restores a list of no tab as an empty window, and keeps aside a list of tabs none of which could be read; the window opens no page by itself, decision A17). **`migrate(raw)`** reads the version first and applies one step per version up to the current; `MIGRATIONS` is empty at version 1 and a newer version is refused, never half used. `createSaver({ store, write })` writes the last value 400 ms after the last change, skips a write that would save the same document, and `flush()` writes at once when the window closes (HSH-25, MNR-K2).

A description a host marks `provisional` is a stand-in made while a plugin is loading: it names a tab that has no face, and never replaces a face a tab already has (a tab restored from a session keeps the face it was saved with until its plugin registers). The saving and restoring are wired by `../../session/` (its README).

## Page state and history (H7)

A history entry carries the page state of the page it LEFT, so Back and Forward give a page back as it was left (docs/ui-next/status/H7.md has the mock's evidence). `Tab.pageState` is the state of the page on screen; `History.states` (absent while nothing was kept) holds, for each other entry, what its page kept when the tab left it, and is `null` at the entry on screen.

- **Step (Back, Forward):** the entry it leaves keeps the live state, and the entry it goes to gives its state back; one commit.
- **Navigation (a link, a crumb, the sidebar, the palette):** the entry it leaves keeps the live state; the entries ahead and their states are dropped; the page opens clean, **except** where the tab has been at this very route before: then it starts with what the NEWEST earlier entry of the same tab with the same route (plugin, page, parameters: another connection is another route) kept, **without `scroll`** (ch16 S141: where the page was scrolled; a new page opens at its top, a step restores it). This is what the mock does for a list while its fingerprint is unchanged (the mock's list module: the lines are quoted in `docs/ui-next/status/H7.md`). A route opened in a new tab, a duplicate, and a change of scope (`history: 'replace'`) start clean. An entry the 50-entry cap drops with the navigation gives nothing.
- **Bounds:** 50 entries, and a state is at most `LIMITS.pageStateBytes` = 16 KiB of JSON in UTF-8: a write over it is refused and the page keeps the state it had. A tab holds at most 51 states (816 KiB), a closed tab one (the 25 of the list: 400 KiB); a page keeps about a hundred bytes in practice.
- **Close, reopen, duplicate:** closing drops the states of the history and keeps the state of the entry on screen; reopening gives the route, the routes of the history and that state back, so Back from a reopened tab opens the page before it clean. A duplicate has the route, one history entry and no page state (ch16 S37).
- **Session:** none of it is saved (ch16 S32: page-local state is not persisted unless the plugin opts in; a saved offset would be wrong after the data changed): `serialise` writes the routes as before, an older snapshot loads as it did, and a snapshot that carries page-state members is read without them. **Keep-alive:** a page that stays mounted keeps its own live state; a page the cap let go, and a page a step or a navigation draws, read the tab's `pageState` as they open (`ui-next/page` `PageMemory`).

## Guarantees

Every operation is O(1) or O(tabs) and asks the plugins a fixed number of questions however many tabs are open (`perf.test.ts`: 500 tabs, about 1,770 operations in about 120 ms with a strip, a page host and a breadcrumb subscribed; the bound is 2 s and the fastest of up to three runs is compared with it, because a shared runner is several times slower than a laptop). `checkInvariants(state)` lists every rule a sound state keeps; the fuzz tests apply it after each of thousands of random operations and also check that what the session would save comes back whole. One tab per singleton page in the whole strip, including through Back, Forward, reopen, restore and duplicate.

## Not here

Windows and split panes (the model has no windows: `how: 'window'` is handed back and the host opens it, `ui-next/plugins/host/windows.ts`; `detach` takes a tab that moved to another window out of the strip without offering it under Recently closed), the New tab menu and All tabs menu as view models, the command registry and keymap, plugin health and the tab state it derives (ready, loading, failed), operations and what makes a tab busy, drag, and the page host's scroll and focus. `testing.ts` is test support: a fixture world of plugins that import nothing real.
