# Developer installation failure feedback

## Business cases

- A developer selects an invalid source before a plugin record exists. The failure must remain inspectable without an IDE or development-mode application.
- An initial build or load fails. The developer needs source context, the underlying error and captured build output, not a success message.
- A developer misses or dismisses a toast. A persistent Notifications entry must reopen the diagnostic.
- A developer fixes configuration or source. Existing settings actions and build-output navigation must remain available, alongside retry through the installation picker.

## UX decision

Reuse the runtime snackbar and host toast architecture. Error toasts expose **Details** first; opening Details reveals a nonmodal Notifications panel with selectable, whitespace-preserving diagnostics, Copy details and all supplied actions. The existing footer Notifications bell reopens recent errors after toast dismissal and shows their count; there is no second floating entry point. Panel controls use base-ui buttons. Keep the newest 20 errors in memory for the application session, including their title, detail, timestamp and recovery actions. Clear removes retained diagnostics. Restart drops history. Do not write arbitrary compiler output or local paths to browser storage: output may contain secrets. Copy details is an explicit user sharing action.

Developer-install errors include the selected source, plugin ID when known and available backend build output. Early metadata/path failures use the same notification history without requiring a plugin record. Build output remains available through the existing devtools output viewer for known plugins. Retry installation opens the existing source picker, avoiding assumptions about a missing plugin record. No automatic retries or modal interruption.

The backend includes at most 200 retained log lines and caps the diagnostic at 1800 Unicode code points, safely within the shared parser's 4096 UTF-16-unit budget. Both output-tail and total-diagnostic limits are disclosed. The developer-install flow alone can display an otherwise unstructured local bridge error message, capped at 3800 UTF-16 units. Global resource-error sanitization is unchanged.

## Official reference

[VS Code notification guidance](https://code.visualstudio.com/api/ux-guidelines/notifications) recommends concise, user-triggered failure notifications with resolving actions, combining notifications, and links to detailed logs. It cautions against modal dialogs for messages that do not require immediate input. This design uses one toast and a nonmodal detail surface, rather than a second notification system or a blocking failure dialog. Retention and local-history limits are Omniview decisions, not VS Code requirements.

## Expected outcomes and smoke scenarios

1. In a packaged application, install a directory without plugin.yaml. Expect one error, a visible Details action, source path and metadata error; no plugin record required.
2. Install a plugin with a Go compiler error. Expect no success toast; Details includes compiler output and source path. Open Build Output to inspect the existing output viewer.
3. Wait beyond the toast lifetime. Open Notifications; expect the same selectable diagnostic. Copy details must copy title, timestamp and diagnostic text.
4. Clear history and expect the Notifications button to disappear. Restart the application and expect no retained errors.
5. Trigger a structured settings error. Expect Details plus every supplied recovery action in the panel, not just the first action.
6. Cancel the source picker. Expect no error notification or retained entry.
7. Disable local storage. Expect live error feedback and session history to remain functional; this feature does not use storage.
8. Correct source/configuration and choose Retry installation. Expect the normal picker and installation flow; prior failure remains until cleared.

Automated coverage should exercise error retention, detail opening, multiple actions, copy, clearing and cancellation suppression. Parent should run frontend tests and `GOWORK=off go test ./backend/pkg/plugin/... -count=1` after integration; no checks run during this change.
