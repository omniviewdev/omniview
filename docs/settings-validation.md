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
