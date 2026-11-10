---
---

Render the host's generic resource table (the workspace resource browser for providers without their own table pages) in the shared Base UI `DataTable` instead of a second hand-rolled virtualized table. The table fills the pane, so the table's own scroll container scrolls the rows and only the rows in view mount.

Rows have a fixed height and are not measured. They are measured only while a visible column declares a plugin `component`, whose output the host cannot size. Row clicks go through one table-level handler that opens the resource's drawer, and the selection and row-action columns never open it. The header sorts through the shared header, including shift-click multi-sort. Selection and the row-action column stay pinned while the table scrolls sideways, a column's declared `width` is exact, and the other columns share the remaining space. Keyboard behavior is the shared component's: Tab reaches the sort buttons, checkboxes and action buttons. Opening a row's resource remains a pointer action.

One menu per table, built on the Base UI menu handle, owns the row actions. Each row mounts only its trigger, and the menu acts on the row that opened it. Exec, Delete with its confirmation dialog, and dismissal on scroll are unchanged. Column visibility keeps its profile-storage key and its merge of newly declared columns, and the first render already shows the restored columns instead of mounting hidden ones and re-rendering. Column definitions are no longer rebuilt on every source patch, and a patch keeps the row object of every unchanged record, so mounted cells skip rows the patch left alone. Value-map columns no longer log to the console for every row.

The column picker subscribes to column visibility explicitly. Its checkboxes stay synchronized with the rendered columns, including hiding and restoring the same column in a compiler-optimized build.

Plugin authors: see "Custom resource table cells" in `docs/plugin-development.md` for how custom-cell row height and column widths behave.
