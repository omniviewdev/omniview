# Settings validation

## Business cases and UX contract

Developers must be able to verify a selected Go executable before saving it. SDK settings register one reusable `Validator` callback returning structured, user-safe results. This is a breaking alpha API cutover: error-returning callbacks must migrate to `settings.ValidationResult`; no compatibility registration path exists. Validation is advisory until save; every save runs validation again, and failed bulk validation changes no values.

Core settings validate changed drafts asynchronously after a short debounce. Each row announces checking, success, or actionable failure. Responses for older drafts, discarded drafts, or another category must never replace current feedback. Save remains available to retry validation, but is disabled while saving. Drafts survive failures. Editing and discard cannot race an in-flight save.

The save action retains its accessible name and exposes busy state until validation and persistence finish. Its action bar disappears only after a successful save; rejected drafts keep their actions and feedback.

An empty Go path retains the existing optional default: automatic discovery in PATH and common installation folders when a build needs Go. Clearing an override succeeds without requiring Go to be installed. This does not claim that automatic discovery has been smoke-tested. Explicit paths reject missing files, directories, and non-executable files, then run `go version` directly without a shell. The smoke command has a five-second deadline and bounded output, and must identify itself as Go. `GOTOOLCHAIN=local` prevents Go toolchain download and `GOWORK=off` avoids ambient workspace selection. No builds or module mutation occurs. Success identifies the version; failures explain selection, execution, timeout, or unexpected output without echoing command output, environment, or submitted values. Sensitive settings always receive generic feedback.

## Expected outcomes

- A reusable structured validator produces success/failure code and message; its failure prevents direct and bulk SDK saves.
- The single registered callback enforces the same constraints during draft evaluation and writes.
- Missing path, directory, non-executable file, nonzero smoke exit, timeout, or non-Go output fails without changing saved values.
- Permission or other filesystem access failures return `unreadable` feedback instead of claiming that the selected executable does not exist.
- A real Go executable succeeds. Empty path succeeds with an explicit automatic-discovery message, even without Go installed.
- Delayed old results cannot overwrite newer drafts. Discard removes feedback. Category switches clear drafts and feedback.
- Save revalidates; replacing a previously valid executable with a failing one cannot bypass enforcement.
- No validation response contains secret input or arbitrary subprocess output.

## Core host lifecycle and restart-required settings

`internal/hostsettings.Runtime` initializes the existing SDK provider once after
profile/singleton authority and settings-store migration, before settings-dependent
services start. `internal/settings.Definitions(isDev)` is the shared definition
source for runtime defaults and frontend metadata. Appearance/terminal category
migrations run during hydration; unknown or invalid stored values are diagnosed
without preventing valid siblings from loading.

Telemetry and profiling consume this prepared provider; neither reads the database
independently. Bootstrap attaches live effects and category invalidation after
initialization, without hydrating or persisting a second time.

Frontend and local-control core writes use the same narrow `hostsettings.Writer`.
The writer validates and normalizes the complete request, commits affected
categories in one bbolt transaction, then publishes requested or previously
unpublished values. Unchanged siblings are not revalidated during publication.
Persistence failure returns an error without publishing changes or success
invalidation. A missing store permits startup with defaults but rejects saves.
Plugin persistence remains separate.

An error after durable commit is different: `CommittedApplyError` reports that
preferences were saved but could not be applied. The UI clears committed drafts
and shows this warning instead of claiming persistence failed. Local control
returns `settings_apply_failed` with `committed: true`.

Restart policy is host-owned, not an SDK schema change.
`SettingsProvider.GetSettingStates()` returns only `requiresRestart` and
`pendingRestart` flags keyed by full setting ID. Pending state compares normalized
configured values with a deep-copied startup baseline; no preference values or
secrets are included. Restoring the startup value clears pending state.
Discard affects drafts only; refreshing settings does not reset the baseline.
Category invalidation refreshes configured values and restart state across windows.

Profiling is the first restart-only consumer:
`developer.pprof_enabled` defaults to false and `developer.pprof_port` defaults to
6060, accepting whole-number ports from 0 through 65535. Both settings are visible
in production. Runtime listener facts come from `HostProfiling.GetStatus()`, not
from the saved toggle. A saved disable does not claim the active listener has
stopped before restart. Invalid recovered profiling preferences fail closed.
`OMNIVIEW_PPROF_PORT` is an explicit launch-time override; it never replaces saved
values or their restart comparison baseline.

### Terminal defaults

New terminal settings use a 12px font. Saved font sizes remain unchanged, and
font size changes apply to open terminals without recreating their sessions.
Reset restores 12px. Until settings load, terminals also use 12px.

An empty Default Shell delegates shell discovery to the backend instead of
forcing Bash or `/bin/sh`. An explicitly saved shell executable remains intact.

Local terminals start in the user's home directory, independent of the app's
launch directory. A missing or inaccessible home fails terminal creation rather
than silently opening at the filesystem root.

The PTY starts with a provisional nonzero grid. After attachment, the terminal
always sends its measured grid, even if fitting before attachment consumed the
resize event. Fits wait for visible layout and run again after font loading,
container changes, and drawer transitions. Backend resize requests are ordered
and coalesce pending sizes so an older response cannot leave the PTY at stale
dimensions. Closing a terminal cancels queued fits and ignores late attachment.

Shell discovery uses `SHELL`, then the account login shell when `SHELL` is absent,
then an installed system fallback. This also applies while registering settings
defaults, before GUI startup. Explicit installed paths and custom symlinks remain
unchanged. Bash, Zsh, Fish, Sh, Dash, Ksh, Nushell, Xonsh, Csh, Tcsh, and
PowerShell use their shell-family-specific interactive login startup.
Unsupported explicit shells fail rather than silently starting a different shell.

Shell frameworks, prompt themes, and environment managers load through the
selected shell's normal startup files; no specific prompt framework is required.
For Bash, a login profile must source `.bashrc` if that is where interactive
customizations live. Fish loads `config.fish`; Zsh loads `.zprofile` and `.zshrc`.

On macOS, startup resolves the interactive login environment before launching
plugins or tools, including when Finder supplies only a sparse `PATH`. Resolution
has a ten-second deadline and bounded output; failure keeps the inherited
environment and emits a generic warning without shell output or secret values.
Host-owned `OMNIVIEW_*`, `PLUGIN_*`, `XDG_*`, `HOME`, temporary roots, and `GOWORK`
remain unchanged, including native-child restoration metadata. Shell startup
files must not require input without a TTY. User shell configuration still
controls the tool `PATH`; GUI startup cannot repair a broken login profile.

#### Verify a production macOS build

Run `task package` from the changed host checkout. This produces the optimized,
production-channel `bin/Omniview.app` with embedded frontend assets, not the
development bundle or a Vite-backed window. The local bundle is ad-hoc signed;
this is not a notarized distribution.

Quit other stable Omniview instances first: the stable-channel singleton can
otherwise activate an older instance instead of running the changed binary.
Open this exact bundle in Finder, not its executable from a terminal.
Verify that new local terminals start at home with the expected shell and tool
`PATH`. Existing shell overrides and font sizes remain unchanged; clear an old
shell override to verify automatic discovery.

Change Terminal Font Size and confirm the open terminal resizes without losing
its session. Relaunch to verify persistence and reset to verify the 12px default.
Resize the drawer, hide and reveal it, and open a fresh terminal to check that
the displayed grid and the shell's reported terminal size agree.

## Plugin settings transport

Plugin settings use the same draft UX and save enforcement. Validators execute inside the plugin process, never on serialized host copies of settings. A dedicated settings gRPC method accepts a draft and returns only valid/code/message. The host controller delegates to the live plugin and never treats cached schema or persisted values as evidence of validation. Missing plugins and transport failures retain drafts and block save. The SDK wrapper evaluates the original registered setting, including sensitive redaction. This protocol addition requires plugins rebuilt against the updated SDK; old plugin processes report unsupported validation rather than silently approving drafts.

Expected tests cover real in-memory gRPC roundtrips, contextual success/failure, no mutation during preflight, secret redaction, host delegation, and plugin UI rejection plus stale response handling. Save still calls the plugin's existing validated SetSettings path, so executable changes after preflight cannot bypass validation.

## Registering validators

Set `settings.Setting.Validator` to a `func(interface{}) settings.ValidationResult`.
Return `Valid: true` for accepted values, a stable `Code` for programmatic
consumers, and a contextual `Message` safe to display. Failure is the zero-value
`Valid: false`; provide a message explaining how to correct the value. Validators
must not mutate settings and should bound any external command or network work.
`Setting.Validation` and provider `ValidateSetting` evaluate drafts without mutation.
`Setting.Validate` returns an error for rejected writes by delegating to the same
evaluation; it is not another callback. Normal setting writes rerun validation.
Sensitive settings always return generic feedback, regardless of callback content.

## Verification

SDK `v0.7.0` contains the single structured `Validator` callback and draft
validation RPC. Rebuild plugins against this release. Source selection requires
an absolute path when testing a local SDK; normal builds use the released
dependency pinned in `go.mod`. Host, providers, runtime, and Vite plugin versions
are aligned at `0.7.3`; normal release tags use the existing release workflow.

The E2E runner checks out the independently reviewed SDK revision selected by
`OMNIVIEW_E2E_REVIEWED_SDK_REVISION`. After reviewing the SDK change, advance that
trusted repository variable to a commit containing validation and keep
`e2e/source-cohort.json` aligned. Updating only `go.mod` cannot update this separate
source selection. Do not bypass the reviewed-source gate for a feature branch.

```sh
SDK_SOURCE=/absolute/path/to/plugin-sdk
(cd "$SDK_SOURCE" && GOWORK=off go test ./settings ./pkg/v1/settings -count=1)
GO_MODFILE="$(GOWORK=off GOFLAGS= go run ./scripts/hostmod/main.go --root "$PWD" --sdk-source "$SDK_SOURCE")"
GOWORK=off GOFLAGS= go test -modfile="$GO_MODFILE" ./internal/settings ./backend/pkg/plugin/settings -count=1
```

Generate frontend bindings with `task bindings SDK_SOURCE="$SDK_SOURCE"`, then run `pnpm exec vitest run ui/pages/settings/CoreSettingsPage.test.tsx ui/pages/settings/PluginSettingsPage.test.tsx ui/pages/settings/SettingsPage.test.tsx` and `pnpm exec tsc --noEmit`. SDK protocol bindings are generated with `make proto` in the selected SDK checkout.

Manual smoke: open Developer Settings, change Go Path to a missing file, and confirm contextual error plus rejected save. Select the absolute path printed by `command -v go`, confirm version success, then save and reload. Clear the path to restore automatic discovery. Select executable scripts that exit 1, print unrelated output, or sleep 30 seconds: each must fail, with timeout feedback within roughly five seconds. Quickly alternate valid and invalid drafts and switch categories during checking; only current draft feedback may appear. Replace a valid executable before save; save must fail and retain the draft.

Plugin smoke: rebuild a plugin against the selected SDK with a registered `Validator` callback returning distinct success and failure codes/messages. Open Settings → Plugins → that plugin. Edit its setting: expect checking followed by the callback's contextual message. Invalid save must retain the draft; valid save must persist across reopening. Quickly change drafts or switch plugins while checking: older responses must not appear. Stop the plugin before save: retain drafts and report unavailable validation. Repeat with a sensitive setting whose callback accidentally includes its input: feedback must stay generic. Older plugin builds without the validation RPC must report unavailable validation, not success.
