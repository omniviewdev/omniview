# @omniviewdev/ui Component Library Expansion — Autonomous Work Plan

## How to use this file

This is a sequential task list for expanding the `@omniviewdev/ui` package. Work through tasks top-to-bottom. Each task has a checkbox — mark it `[x]` when done. After completing each phase, run the verification step before moving on.

**Working directory**: `/Users/joshuapare/Repos/omniview/packages/omniviewdev-ui/`

**Key conventions** (read existing files to match style):
- Components use `displayName`, export default + named type export
- Props interfaces exported alongside components
- MUI imports from full paths (`@mui/material/Button`, not `@mui/material`)
- CSS tokens use `var(--ov-*)` pattern
- Barrel exports in each `index.ts`
- Showcase pages use `Section`, `Example`, `ImportStatement`, `PropsTable` helpers from `src/showcase/helpers/`
- Showcase router is in `src/showcase/router.tsx` — add routes there
- Showcase vite aliases are in `src/showcase/vite.config.showcase.ts` — add aliases for new entry points
- Build entry points go in `vite.config.ts` (named object keys)
- Package exports/typesVersions go in `package.json`

**Verification after each phase**:
```bash
cd /Users/joshuapare/Repos/omniview/packages/omniviewdev-ui
npx tsc --noEmit           # Must pass with zero errors
pnpm build                 # Must succeed, check named entry files exist in dist/
```

---

## Phase 1 Status: COMPLETE

The following are already implemented:
- [x] `src/types/` — variants.ts, maps.ts, index.ts (SemanticColor, Emphasis, ComponentSize, etc.)
- [x] `src/theme/mui.d.ts` — augmented for link variant, xs/xl sizes, Chip soft, Alert soft
- [x] `src/theme/customizations/inputs.tsx` — xs, xl, link button variants added
- [x] `src/buttons/` — Button, IconButton, CopyButton, ConfirmButton, ActionMenu, ButtonGroup
- [x] `src/feedback/` — Alert, StatusDot, StatusPill, EmptyState, ErrorState, Skeleton
- [x] `src/typography/` — Text, Heading, CodeInline, CodeBlock
- [x] `src/showcase/helpers/VariantMatrix.tsx` — generic color×emphasis grid
- [x] `src/showcase/pages/ButtonPage.tsx`, `FeedbackPage.tsx`, `TypographyPage.tsx`
- [x] `src/showcase/router.tsx` — updated with new routes, collapsible sidebar, 240px width
- [x] `vite.config.ts` — fixed externals (@mui/material, @emotion/styled), named entry object
- [x] `package.json` — new exports/typesVersions for types, buttons, feedback, typography
- [x] `src/showcase/vite.config.showcase.ts` — aliases for new entry points
- [x] Build passes, TypeScript passes

---

## Phase 2: Form Inputs

### 2.1 — New input components in `src/inputs/`

- [x] **`src/inputs/TextField.tsx`** — Wraps MUI TextField
  - Props: `size?: ComponentSize`, `color?: SemanticColor`, `readOnly?: boolean`, `monospace?: boolean`, `debounced?: boolean`, `debounceMs?: number`, `value`, `onChange`, `label?`, `helperText?`, `error?`, `placeholder?`, `fullWidth?`, `startAdornment?`, `endAdornment?`, `sx?`
  - `monospace` sets fontFamily to `var(--ov-font-mono)`
  - `debounced` integrates debounce logic (internal state + setTimeout, calls onChange after delay)
  - Map size/color via `toMuiSize`/`toMuiColor` from `../types`

- [x] **`src/inputs/TextArea.tsx`** — Wraps MUI TextField multiline
  - Props: `size?`, `color?`, `autosize?: boolean`, `maxLength?: number`, `showCount?: boolean`, `value`, `onChange`, `rows?`, `maxRows?`, `label?`, `helperText?`, `error?`, `placeholder?`, `fullWidth?`, `sx?`
  - `showCount` renders character counter below (e.g., "42 / 500")
  - `autosize` sets `minRows`/`maxRows` behavior

- [x] **`src/inputs/Select.tsx`** — Wraps MUI Select + FormControl
  - Types: `SelectOption = { value: string; label: string; disabled?: boolean; icon?: ReactNode }`
  - Props: `options: SelectOption[]`, `size?`, `color?`, `label?`, `helperText?`, `placeholder?`, `searchable?: boolean`, `multiple?: boolean`, `loading?: boolean`, `value`, `onChange`, `error?`, `fullWidth?`, `sx?`
  - `searchable` adds a text input inside the dropdown menu for filtering
  - `loading` shows CircularProgress in the dropdown
  - `multiple` enables multi-select with chips

- [x] **`src/inputs/Autocomplete.tsx`** — Wraps MUI Autocomplete
  - Props: `options`, `size?`, `color?`, `creatable?: boolean`, `loading?: boolean`, `groupBy?: (option) => string`, `renderOption?: (option) => ReactNode`, `value`, `onChange`, `label?`, `helperText?`, `placeholder?`, `error?`, `multiple?: boolean`, `fullWidth?`, `sx?`
  - `creatable` allows typing new values (freeSolo mode)

- [x] **`src/inputs/Checkbox.tsx`** — Wraps MUI Checkbox + FormControlLabel
  - Props: `size?`, `color?`, `indeterminate?: boolean`, `label?: string`, `checked`, `onChange`, `disabled?`, `sx?`

- [x] **`src/inputs/RadioGroup.tsx`** — Wraps MUI RadioGroup
  - Types: `RadioOption = { value: string; label: string; disabled?: boolean; description?: string }`
  - Props: `options: RadioOption[]`, `size?`, `color?`, `layout?: 'row' | 'column'`, `label?: string`, `value`, `onChange`, `sx?`

- [x] **`src/inputs/Switch.tsx`** — Wraps MUI Switch + FormControlLabel
  - Props: `size?`, `color?`, `label?: string`, `labelPlacement?: 'start' | 'end' | 'top' | 'bottom'`, `checked`, `onChange`, `disabled?`, `sx?`

- [x] **`src/inputs/Slider.tsx`** — Wraps MUI Slider
  - Props: `size?`, `color?`, `range?: boolean`, `marks?: boolean | Mark[]`, `showValue?: boolean`, `value`, `onChange`, `min?`, `max?`, `step?`, `disabled?`, `sx?`
  - `range` enables two-thumb mode (value becomes `[number, number]`)
  - `showValue` shows current value label

- [x] **`src/inputs/TagInput.tsx`** — Custom: text input that creates chips
  - Props: `value: string[]`, `onChange: (tags: string[]) => void`, `suggestions?: string[]`, `maxTags?: number`, `creatable?: boolean`, `size?`, `color?`, `placeholder?`, `sx?`
  - Uses MUI Chip + OutlinedInput
  - Enter/comma creates a tag, backspace removes last tag
  - If `suggestions` provided, show autocomplete dropdown
  - If `creatable` is false, only allow values from suggestions

- [x] **`src/inputs/KeyValueEditor.tsx`** — Rows of key/value text fields with add/remove
  - Props: `value: Record<string, string>`, `onChange: (kv: Record<string, string>) => void`, `addLabel?: string`, `readOnly?: boolean`, `validateKey?: (key: string) => string | undefined`, `validateValue?: (value: string) => string | undefined`, `size?`, `sx?`
  - Each row: key TextField + value TextField + delete IconButton
  - Add button at bottom
  - Validation functions return error message string or undefined

### 2.2 — Form layout components in `src/inputs/`

- [x] **`src/inputs/FormField.tsx`** — Standardizes label + input + helper text + error
  - Props: `label: string`, `required?: boolean`, `error?: string`, `helperText?: string`, `children: ReactNode`, `layout?: 'vertical' | 'horizontal'`, `sx?`
  - `vertical`: label above input. `horizontal`: label left, input right (grid 4/8 ratio)

- [x] **`src/inputs/FormSection.tsx`** — Groups FormFields with header
  - Props: `title: string`, `description?: string`, `collapsible?: boolean`, `defaultCollapsed?: boolean`, `children: ReactNode`, `sx?`
  - Uses Divider above, optional Collapse for content

### 2.3 — Update `src/inputs/index.ts`

- [x] Add exports for all new components and their types to the barrel file. Keep existing SearchInput and DebouncedInput exports.

### 2.4 — Showcase pages

- [x] **`src/showcase/pages/TextFieldPage.tsx`** — TextField, TextArea demos with all props
- [x] **`src/showcase/pages/SelectPage.tsx`** — Select, Autocomplete demos
- [x] **`src/showcase/pages/FormPage.tsx`** — FormField, FormSection, Checkbox, RadioGroup, Switch, Slider demos
- [x] **`src/showcase/pages/TagInputPage.tsx`** — TagInput, KeyValueEditor demos

- [x] **Update `src/showcase/router.tsx`**: Add routes and sidebar entries for new pages under "Inputs" section

### 2.5 — Verify

- [x] `npx tsc --noEmit` passes
- [x] `pnpm build` succeeds

---

## Phase 3 Status: COMPLETE

- [x] `src/overlays/Dialog.tsx` — Dialog with size/variant support
- [x] `src/overlays/Modal.tsx` — Lighter overlay without title/footer chrome
- [x] `src/overlays/Drawer.tsx` — Drawer with anchor, resize, persistent mode
- [x] `src/overlays/Tooltip.tsx` — Tooltip with default/rich/code variants
- [x] `src/overlays/Popover.tsx` — Popover with placement mapping
- [x] `src/overlays/ToastProvider.tsx` — Context provider with reducer, Snackbar+Alert rendering
- [x] `src/overlays/useToast.ts` — Hook with toast/dismiss/dismissAll + convenience methods
- [x] `src/overlays/index.ts` — Barrel exports
- [x] `vite.config.ts` — overlays entry point added
- [x] `package.json` — ./overlays exports + typesVersions added
- [x] `src/showcase/vite.config.showcase.ts` — overlays alias added
- [x] `src/showcase/App.tsx` — ToastProvider wrapping app
- [x] Showcase pages: DialogPage, DrawerPage, TooltipPage, PopoverPage, ToastPage
- [x] `src/showcase/router.tsx` — Overlays section added
- [x] `npx tsc --noEmit` passes
- [x] `pnpm build` succeeds — overlays.cjs (7.90 kB)

---

## Phase 4: Navigation + Table

### 4.1 — Create `src/navigation/` directory with components

- [x] **`src/navigation/Tabs.tsx`** — Core IDE tab component
  - Types: `TabItem = { key: string; label: string; icon?: ReactNode; disabled?: boolean }`
  - Props: `tabs: TabItem[]`, `value: string`, `onChange: (key: string) => void`, `variant?: 'line' | 'pill' | 'segmented'`, `size?: ComponentSize`, `closable?: boolean`, `onClose?: (key: string) => void`, `scrollable?: boolean`, `addButton?: boolean`, `onAdd?: () => void`, `sx?`
  - `line` = standard MUI Tabs underline indicator
  - `pill` = rounded background on active tab (custom sx styling)
  - `segmented` = ToggleButtonGroup-like appearance
  - `closable` adds X icon per tab
  - `addButton` shows + button at the end

- [x] **`src/navigation/TabPanel.tsx`** — Content area for tabs
  - Props: `value: string`, `activeValue: string`, `children`, `keepMounted?: boolean`
  - If `keepMounted`, uses `display: none` when inactive instead of unmounting

- [x] **`src/navigation/TreeView.tsx`** — Recursive tree component
  - Types: `TreeNode = { id: string; label: string; icon?: ReactNode; children?: TreeNode[]; badge?: ReactNode; disabled?: boolean }`
  - Props: `nodes: TreeNode[]`, `selected?: string`, `onSelect?: (id: string) => void`, `expanded?: string[]`, `onToggle?: (id: string) => void`, `multiSelect?: boolean`, `checkboxes?: boolean`, `lazyLoad?: boolean`, `onLoadChildren?: (id: string) => Promise<TreeNode[]>`, `contextMenu?: (node: TreeNode) => ReactNode`, `sx?`
  - Renders nested list items with collapse animation (MUI Collapse)
  - Expand/collapse on chevron click
  - `lazyLoad` shows spinner on expand, calls `onLoadChildren`
  - `contextMenu` render function for right-click menu

- [x] **`src/navigation/Breadcrumbs.tsx`** — Wraps MUI Breadcrumbs
  - Types: `BreadcrumbItem = { label: string; href?: string; icon?: ReactNode; onClick?: () => void }`
  - Props: `items: BreadcrumbItem[]`, `separator?: ReactNode`, `maxItems?: number`, `sx?`

- [x] **`src/navigation/Stepper.tsx`** — Wraps MUI Stepper
  - Types: `StepItem = { label: string; description?: string; icon?: ReactNode; optional?: boolean }`
  - Props: `steps: StepItem[]`, `activeStep: number`, `orientation?: 'horizontal' | 'vertical'`, `variant?: 'linear' | 'nonLinear'`, `sx?`

- [x] **`src/navigation/Pagination.tsx`** — Wraps MUI Pagination
  - Props: `count: number`, `page: number`, `onChange: (page: number) => void`, `variant?: 'compact' | 'full'`, `size?: ComponentSize`, `sx?`
  - `compact` renders only prev/next buttons
  - `full` renders page numbers

### 4.2 — Enhanced table in `src/table/`

- [x] **`src/table/DataTable.tsx`** — Full table component on TanStack Table
  - Props: `columns: ColumnDef[]`, `data: any[]`, `density?: Density`, `loading?: boolean`, `error?: ReactNode`, `emptyState?: ReactNode`, `onRowClick?: (row) => void`, `selection?: 'none' | 'single' | 'multi'`, `stickyHeader?: boolean`, `rowActions?: (row) => ReactNode`, `expandable?: boolean`, `renderDetail?: (row) => ReactNode`, `sx?`
  - Density: compact=28px rows/6px padding, comfortable=40px/12px, spacious=56px/16px
  - Applied via `data-density` attribute + CSS
  - Uses MUI Table/TableHead/TableBody/TableRow/TableCell
  - Integrates ColumnFilter from existing code
  - Shows Skeleton rows when loading
  - Shows EmptyState when no data
  - Shows ErrorState on error

- [x] **`src/table/TableToolbar.tsx`** — Top bar above DataTable
  - Props: `title?: string`, `searchValue?: string`, `onSearch?: (value: string) => void`, `filters?: ReactNode`, `actions?: ReactNode`, `selectedCount?: number`, `sx?`
  - Shows search input (using SearchInput), filter area, bulk action buttons when items selected

- [x] **`src/table/TableSkeleton.tsx`** — Skeleton loading for tables
  - Props: `columns: number`, `rows?: number` (default 5), `density?: Density`

- [x] **`src/table/TableEmptyState.tsx`** — Empty state for table body
  - Props: `icon?`, `title`, `description?`, `action?`, `colSpan: number`
  - Renders as a full-width table row

- [x] Update `src/table/index.ts` with new exports

### 4.3 — Create `src/navigation/index.ts`

- [x] Export all navigation components and types

### 4.4 — Build config updates

- [x] **`vite.config.ts`**: Add `navigation: resolve(__dirname, "src/navigation/index.ts")` to entry
- [x] **`package.json`**: Add `./navigation` to exports and typesVersions
- [x] **`src/showcase/vite.config.showcase.ts`**: Add alias for `@omniviewdev/ui/navigation`

### 4.5 — Showcase pages

- [x] **`src/showcase/pages/TabsPage.tsx`** — Tabs with all variants, closable, scrollable
- [x] **`src/showcase/pages/TreeViewPage.tsx`** — TreeView with nested data, lazy loading
- [x] **`src/showcase/pages/BreadcrumbsPage.tsx`** — Breadcrumbs demos
- [x] **`src/showcase/pages/DataTablePage.tsx`** — DataTable with density, selection, toolbar

- [x] **Update `src/showcase/router.tsx`**: Add routes and "Navigation" + updated "Data Display" sections

### 4.6 — Verify

- [x] `npx tsc --noEmit` passes
- [x] `pnpm build` succeeds — navigation.cjs (6.96 kB), table.cjs (7.34 kB)

---

## Phase 5: Editors

### 5.1 — Create `src/editors/` directory

- [x] **`src/editors/CodeEditor.tsx`** — Wraps Monaco Editor
  - Props: `value: string`, `onChange?: (value: string) => void`, `language?: string`, `readOnly?: boolean`, `diff?: boolean`, `original?: string`, `minimap?: boolean`, `lineNumbers?: boolean`, `wordWrap?: boolean`, `maxHeight?: number | string`, `theme?: string`, `onSave?: (value: string) => void`, `sx?`
  - Uses `@monaco-editor/react` (import dynamically / lazy)
  - Registers Omniview themes in `beforeMount`
  - `onSave` fires on Ctrl+S / Cmd+S
  - `diff` mode uses MonacoDiffEditor with `original` prop
  - Wrap in Box with border and proper sizing

- [x] **`src/editors/DiffViewer.tsx`** — Dedicated diff component
  - Props: `original: string`, `modified: string`, `language?: string`, `layout?: 'sideBySide' | 'unified'`, `readOnly?: boolean`, `sx?`
  - Header shows change count (additions/deletions)
  - Uses Monaco diff editor internally

- [x] **`src/editors/Terminal.tsx`** — Wraps xterm.js
  - Props: `onData?: (data: string) => void`, `onResize?: (cols: number, rows: number) => void`, `fontSize?: number`, `fontFamily?: string`, `cursorStyle?: 'block' | 'underline' | 'bar'`, `cursorBlink?: boolean`, `scrollback?: number`, `theme?: object`, `sx?`
  - Exposes `write(data)`, `clear()`, `focus()` via `React.forwardRef` + `useImperativeHandle`
  - Sets up FitAddon for auto-resize
  - Uses ResizeObserver to call fit() when container size changes

- [x] **`src/editors/CommandPalette.tsx`** — Command palette overlay
  - Types: `CommandItem = { id: string; label: string; icon?: ReactNode; category?: string; shortcut?: string; description?: string }`
  - Props: `open`, `onClose`, `items: CommandItem[]`, `onSelect: (item: CommandItem) => void`, `placeholder?: string`, `recentItems?: CommandItem[]`, `categories?: string[]`
  - Uses MUI Dialog + text input at top + scrollable list below
  - Fuzzy search via simple case-insensitive substring matching
  - Keyboard: arrow keys navigate, Enter selects, Escape closes
  - Group items by category if categories provided
  - Show recent items at top when input is empty

- [x] **`src/editors/themes.ts`** — Monaco theme definitions
  - `omniviewDark` theme object using --ov-* dark token values (hardcoded HSL equivalents since Monaco needs direct colors)
  - `omniviewLight` theme object
  - `registerOmniviewThemes(monaco)` function

### 5.2 — Create `src/editors/index.ts`

- [x] Export all editor components. Use `export type` for CommandItem.
- [x] Note: These components have optional peer deps. They should gracefully handle missing deps (try/catch dynamic import or show error message).

### 5.3 — Build config

- [x] **`vite.config.ts`**: Add editors entry point. Add `monaco-editor`, `@monaco-editor/react`, `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl` to externals
- [x] **`package.json`**: Add `./editors` exports/typesVersions. Add optional peer deps for monaco-editor, @xterm/xterm, @monaco-editor/react, @xterm/addon-fit, @xterm/addon-webgl
- [x] **`src/showcase/vite.config.showcase.ts`**: Add alias

### 5.4 — Showcase pages

- [x] **`src/showcase/pages/CodeEditorPage.tsx`** — CodeEditor demos (YAML, JSON, read-only)
- [x] **`src/showcase/pages/CommandPalettePage.tsx`** — CommandPalette demo

- [x] **Update `src/showcase/router.tsx`**: Add "Editors" sidebar section

### 5.5 — Verify

- [x] `npx tsc --noEmit` passes
- [x] `pnpm build` succeeds — editors.cjs (8.76 kB)

---

## Phase 6: Domain Components (Kubernetes/DevOps)

### 6.1 — Create `src/domain/` directory

- [x] **`src/domain/types.ts`** — Domain type definitions
  ```typescript
  export interface KubeEvent {
    type: 'Normal' | 'Warning';
    reason: string;
    message: string;
    count?: number;
    firstTimestamp?: string;
    lastTimestamp?: string;
    involvedObject?: { kind: string; name: string; namespace?: string };
  }
  export interface LogLine {
    timestamp?: string;
    content: string;
    severity?: 'info' | 'warn' | 'error' | 'debug';
    source?: string;
  }
  export interface DescriptionItem {
    label: string;
    value: React.ReactNode;
    icon?: React.ReactNode;
    copyable?: boolean;
  }
  ```

- [x] **`src/domain/ResourceRef.tsx`** — Compact resource reference
  - Props: `kind: string`, `name: string`, `namespace?: string`, `icon?: ReactNode`, `onNavigate?: () => void`, `size?: ComponentSize`, `interactive?: boolean`
  - Renders: icon + kind chip (small, muted) + name
  - If `interactive`, renders as a clickable link calling `onNavigate`
  - Shows namespace in parentheses if provided

- [x] **`src/domain/ResourceStatus.tsx`** — Kubernetes status indicator
  - Props: `status: string`, `conditions?: Array<{ type: string; status: string; reason?: string; message?: string }>`, `size?: ComponentSize`, `showTooltip?: boolean`
  - Maps k8s status strings to StatusPill: Running→success, Pending→info, Failed→error, Succeeded→success, Unknown→neutral, CrashLoopBackOff→error, Terminating→warning, etc.
  - `conditions` renders a Tooltip showing the full condition list

- [x] **`src/domain/DescriptionList.tsx`** — Key-value pairs in definition list layout
  - Props: `items: DescriptionItem[]`, `columns?: 1 | 2 | 3`, `size?: ComponentSize`
  - Uses CSS Grid for columns
  - Each item: label (muted, small) + value (default color)
  - If `copyable`, show CopyButton next to value (stringify ReactNode for copy)

- [x] **`src/domain/ObjectInspector.tsx`** — Tabbed inspector panel
  - Props: `data: object`, `title?: string`, `tabs?: Array<{ key: string; label: string; content: ReactNode }>`, `defaultTab?: string`, `readOnly?: boolean`
  - Default tabs: Summary (DescriptionList auto-generated from flat object keys), YAML (CodeBlock with yaml content), Raw JSON (CodeBlock with json)
  - Custom tabs appended after defaults
  - Uses Tabs/TabPanel from navigation (if available, otherwise simple div-based tabs)

- [x] **`src/domain/EventsList.tsx`** — Filterable event list
  - Props: `events: KubeEvent[]`, `loading?: boolean`, `groupBy?: 'object' | 'time'`
  - Each event row: type chip (Normal=info, Warning=warning), reason (bold), message, count badge, age
  - Optional grouping by involved object or by time bucket

- [x] **`src/domain/LogsViewer.tsx`** — Virtual-scrolled log viewer
  - Props: `lines: LogLine[]`, `follow?: boolean`, `onFollow?: (follow: boolean) => void`, `wrap?: boolean`, `timestamps?: boolean`, `maxLines?: number`, `severity?: 'info' | 'warn' | 'error' | 'debug'`
  - Uses a simple virtualized list (fixed row height, transform: translateY, visible window calculation)
  - Severity coloring: info=default, warn=warning, error=danger, debug=muted
  - `follow` auto-scrolls to bottom on new lines
  - `timestamps` toggles timestamp column
  - `wrap` toggles word wrapping

- [x] **`src/domain/MetricCard.tsx`** — Stat card
  - Props: `label: string`, `value: string | number`, `unit?: string`, `delta?: number`, `deltaDirection?: 'up' | 'down' | 'neutral'`, `sparkline?: ReactNode`, `loading?: boolean`
  - Layout: label (small, muted) + value (large, bold) + unit + delta (colored: up=success, down=danger, neutral=muted) + sparkline slot
  - If `loading`, show Skeleton

- [x] **`src/domain/SecretValueMask.tsx`** — Masked secret value
  - Props: `value: string`, `revealed?: boolean`, `onReveal?: () => void`, `copyable?: boolean`
  - Shows dots by default
  - Eye icon button toggles reveal
  - Optional CopyButton for the raw value

### 6.2 — Create `src/domain/index.ts`

- [x] Export all domain components and types

### 6.3 — Build config

- [x] **`vite.config.ts`**: Add domain entry
- [x] **`package.json`**: Add `./domain` exports/typesVersions
- [x] **`src/showcase/vite.config.showcase.ts`**: Add alias

### 6.4 — Showcase pages

- [x] **`src/showcase/pages/ResourceRefPage.tsx`** — ResourceRef + ResourceStatus demos
- [x] **`src/showcase/pages/ObjectInspectorPage.tsx`** — ObjectInspector with sample k8s Pod object
- [x] **`src/showcase/pages/LogsViewerPage.tsx`** — LogsViewer with generated sample data
- [x] **`src/showcase/pages/EventsListPage.tsx`** — EventsList with sample events
- [x] **`src/showcase/pages/MetricCardPage.tsx`** — MetricCard grid demos

- [x] **Update `src/showcase/router.tsx`**: Add "Domain (Kubernetes)" sidebar section

### 6.5 — Verify

- [x] `npx tsc --noEmit` passes
- [x] `pnpm build` succeeds — domain.cjs (10.39 kB)

---

## Phase 7: Layout Components

### 7.1 — Create `src/layout/` directory

- [x] **`src/layout/useResizablePanel.ts`** — Shared resize hook
  - Options: `direction: 'horizontal' | 'vertical'`, `defaultSize: number`, `minSize?: number`, `maxSize?: number`, `onResize?: (size: number) => void`, `storageKey?: string`
  - Returns: `{ size: number, isDragging: boolean, handleProps: { onMouseDown }, reset: () => void }`
  - On mousedown: add mousemove + mouseup listeners to document
  - On mousemove: calculate new size based on mouse position delta, clamp to min/max
  - On mouseup: remove listeners, save to localStorage if storageKey
  - Load initial size from localStorage if storageKey exists

- [x] **`src/layout/ResizableSplitPane.tsx`** — Two-pane resizable layout
  - Props: `direction?: 'horizontal' | 'vertical'`, `defaultSize?: number`, `minSize?: number`, `maxSize?: number`, `onResize?: (size: number) => void`, `children` (exactly 2), `handleSize?: number`, `id?: string`, `sx?`
  - Uses `useResizablePanel` internally
  - Renders flex container with first child (fixed size) + drag handle + second child (flex: 1)
  - Handle: 4px div with hover highlight, cursor: col-resize or row-resize
  - Double-click handle to toggle between defaultSize and minSize
  - `id` enables localStorage persistence

- [x] **`src/layout/AppShell.tsx`** — CSS Grid application layout
  - Props: `header?: ReactNode`, `sidebar?: ReactNode`, `footer?: ReactNode`, `children`, `sidebarWidth?: number | string`, `sidebarCollapsed?: boolean`, `onSidebarToggle?: () => void`, `headerHeight?: number | string`, `footerHeight?: number | string`, `sx?`
  - grid-template-areas: "header header" / "sidebar main" / "footer footer"
  - Sets CSS variables for sub-component reference

- [x] **`src/layout/Panel.tsx`** — IDE panel component
  - Props: `title?: string`, `icon?: ReactNode`, `toolbar?: ReactNode`, `children`, `collapsible?: boolean`, `onClose?: () => void`, `elevation?: Elevation`, `sx?`
  - Header bar: icon + title + toolbar actions + close button
  - `collapsible` adds collapse toggle to header

- [x] **`src/layout/Stack.tsx`** — Thin wrapper on MUI Stack
  - Props: `direction?: 'row' | 'column'`, `gap?: number`, `align?: string`, `justify?: string`, `wrap?: boolean`, `divider?: boolean`, `children`, `sx?`
  - `divider` inserts MUI Divider between children

- [x] **`src/layout/Inline.tsx`** — Convenience: Stack with `direction='row'` + `wrap=true`
  - Props: same as Stack but defaults changed

- [x] **`src/layout/Spacer.tsx`** — `flex: 1` div
  - No props needed (accepts sx? for overrides)

### 7.2 — Create `src/layout/index.ts`

- [x] Export all layout components and hooks

### 7.3 — Build config

- [x] **`vite.config.ts`**: Add layout entry
- [x] **`package.json`**: Add `./layout` exports/typesVersions
- [x] **`src/showcase/vite.config.showcase.ts`**: Add alias

### 7.4 — Showcase pages

- [x] **`src/showcase/pages/ResizableSplitPanePage.tsx`** — ResizableSplitPane demos
- [x] **`src/showcase/pages/AppShellPage.tsx`** — AppShell demo with header/sidebar/footer
- [x] **`src/showcase/pages/PanelPage.tsx`** — Panel demos
- [x] **`src/showcase/pages/LayoutPrimitivesPage.tsx`** — Stack, Inline, Spacer demos

- [x] **Update `src/showcase/router.tsx`**: Add "Layout" sidebar section

### 7.5 — Verify

- [x] `npx tsc --noEmit` passes
- [x] `pnpm build` succeeds — layout.cjs (5.27 kB)

---

## Phase 8: Utility Components + Pickers

### 8.1 — Utility components in `src/components/`

- [x] **`src/components/ClipboardText.tsx`** — Truncated text with copy on hover
  - Props: `value: string`, `truncate?: boolean`, `maxWidth?: number | string`, `sx?`
  - Shows CopyButton on hover

- [x] **`src/components/OverflowText.tsx`** — Tooltip on overflow
  - Props: `children: string`, `maxWidth?: number | string`, `copyOnClick?: boolean`, `sx?`
  - Uses ResizeObserver or ref scrollWidth comparison to detect overflow
  - Shows Tooltip only when text overflows

- [x] **`src/components/InlineEdit.tsx`** — Click-to-edit text
  - Props: `value: string`, `onSave: (value: string) => void`, `placeholder?: string`, `size?: ComponentSize`, `sx?`
  - Display mode: renders as Text, click to switch to edit mode
  - Edit mode: TextField, blur or Enter saves, Escape cancels

- [x] **`src/components/HotkeyHint.tsx`** — Keyboard shortcut badges
  - Props: `keys: string[]`
  - Renders each key in a styled `<kbd>` element
  - Auto-maps: "Meta" → platform-aware (⌘ on Mac, Ctrl on others)

- [x] **`src/components/Badge.tsx`** — Wraps MUI Badge
  - Props: `count?: number`, `dot?: boolean`, `color?: SemanticColor`, `max?: number`, `children`, `sx?`

- [x] **`src/components/Avatar.tsx`** — Wraps MUI Avatar
  - Props: `src?: string`, `name?: string`, `size?: ComponentSize`, `color?: SemanticColor`, `sx?`
  - `name` generates initials (first letter of first two words)
  - Color from name hash if no explicit color

### 8.2 — Pickers in `src/inputs/`

- [x] **`src/inputs/ColorPicker.tsx`** — Color palette grid
  - Props: `value: string`, `onChange: (color: string) => void`, `presets?: string[]`, `allowCustom?: boolean`, `sx?`
  - Grid of color swatches, click to select
  - `allowCustom` adds hex input at bottom

- [x] **`src/inputs/TimeRangePicker.tsx`** — Time range for logs/metrics
  - Types: `TimeRange = { from: Date; to: Date }`
  - Props: `value: TimeRange`, `onChange: (range: TimeRange) => void`, `presets?: Array<{ label: string; duration: number }>`, `customRange?: boolean`, `timezone?: string`, `sx?`
  - Default presets: Last 15m, 1h, 6h, 24h, 7d
  - `customRange` opens a popover with two date/time inputs

### 8.3 — Update barrel files

- [x] Update `src/index.ts` to export new components from `src/components/`
- [x] Update `src/inputs/index.ts` to export new pickers

### 8.4 — Showcase pages

- [x] **`src/showcase/pages/UtilityComponentsPage.tsx`** — ClipboardText, OverflowText, InlineEdit, HotkeyHint demos
- [x] **`src/showcase/pages/BadgePage.tsx`** — Badge demos
- [x] **`src/showcase/pages/AvatarPage.tsx`** — Avatar demos
- [x] **`src/showcase/pages/PickersPage.tsx`** — ColorPicker, TimeRangePicker demos

- [x] **Update `src/showcase/router.tsx`**: Add entries to "Components" and "Inputs" sections, add "Utilities" section

### 8.5 — Verify

- [x] `npx tsc --noEmit` passes
- [x] `pnpm build` succeeds — all 15 entry points built

---

## Final Sidebar Structure

After all phases, the showcase sidebar should have these sections (update router.tsx as you go):

```
Foundations
  Theme & Tokens
  Icons
  Typography

Buttons
  Button
  IconButton / CopyButton / ConfirmButton
  ActionMenu

Inputs
  TextField & TextArea
  Select & Autocomplete
  Checkbox, Radio & Switch
  Slider
  TagInput
  KeyValueEditor
  FormField & FormSection
  DebouncedInput & Search
  Pickers

Overlays
  Dialog
  Drawer
  Tooltip & Popover
  Toast

Feedback
  Alert & Status
  EmptyState & ErrorState
  Skeleton

Navigation
  Tabs
  TreeView
  Breadcrumbs
  Stepper & Pagination

Data Display
  DataTable
  Table Cells
  Cards
  Expandable Sections
  Badge & Avatar

Editors
  CodeEditor
  DiffViewer
  CommandPalette

Domain (Kubernetes)
  ResourceRef & ResourceStatus
  ObjectInspector
  EventsList & LogsViewer
  MetricCard & SecretValueMask

Layout
  AppShell
  ResizableSplitPane
  Panel
  Stack & Inline

Utilities
  ClipboardText & OverflowText
  InlineEdit
  HotkeyHint
  Formatters (existing)
```

---

## Notes for the autonomous agent

1. **Read before writing**: Always read existing files before modifying them. The patterns are consistent.
2. **Match existing style**: Look at Phase 1 components as reference. Same import patterns, displayName, props interface, etc.
3. **Don't break existing code**: Keep all existing exports intact when updating barrel files.
4. **TypeScript must pass**: Run `npx tsc --noEmit` after each phase. Fix all errors before moving on.
5. **Build must succeed**: Run `pnpm build` after each phase. Check that new entry point files appear in dist/.
6. **One phase at a time**: Complete all tasks in a phase, verify, then move to the next phase.
7. **Mark tasks done**: Update the checkboxes in this file as you complete tasks.
8. **Keep components simple**: These are thin wrappers around MUI with our consistent API. Don't over-engineer.
9. **Showcase pages**: Each page should demonstrate all key props with interactive examples. Follow the pattern in ButtonPage.tsx, FeedbackPage.tsx, TypographyPage.tsx.
10. **For editors**: monaco-editor and xterm are heavy optional deps. Use dynamic imports and handle the case where they're not installed gracefully (show a message like "Install @monaco-editor/react to use CodeEditor").
