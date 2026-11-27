# Settings: Appearance and searchable plugin preferences

Branch: `wip/settings-sheet-parity`. Worktree: `../worktrees/settings-sheet-parity`.

2026-11-27: Audited layout, core settings consumers, and plugin settings against the supplied design. The approved first slice retains the standalone window and browser sheet, increases the default size, separates the navigation and form panes, and restores the Appearance controls. Terminal, Developer and plugin settings are separate slices. Before PR, show the native window and the constrained browser sheet using the real host.

## Dev tools

Use the UI Next host for screenshot evidence. The Settings probe uses fixtures and does not substitute for native or server-mode evidence.

2026-11-27: Built and opened both real hosts. Captured native WKWebView at its preferred size and browser WebKit at 1440 × 900 and 900 × 600 in `.local/settings-proof/`. The native screenshot shows all nine themes plus Layout and text above Window material. The constrained browser places the cards below the Theme label. No PR opened pending screenshot review.

Verification: 193 settings and appearance tests, 236 targeted kit tests, the UI Next window and bootstrap Go tests, and 828 WebKit window/page/sheet probe checks passed. The probe ran with `FONT_DELAY_MS=40` at 1440 × 900 (initial load average 3.25). Windows, Linux, and Chromium were not exercised.

2026-11-27: After screenshot review, removed the fixed form width and added search plus expandable Core and Plugins branches. Real-host WebKit measured 12 px on both sides. Searching for “cursor” opens the matching Terminal field. Changed the running Kubernetes plugin’s layout and read the committed value independently through the settings service. The final sidebar checks passed: 233 targeted tests, application typecheck, and 1,093 WebKit probe checks.

Real-host captures: [Appearance](settings-sheet-parity-assets/sidebar-appearance.png), [search](settings-sheet-parity-assets/sidebar-search.png), and [installed Kubernetes settings](settings-sheet-parity-assets/sidebar-plugin.png).
