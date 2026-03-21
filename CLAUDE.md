# Claude Code Guidelines

## Wails Bindings

**Always use the Taskfile task to generate bindings.** Never run `wails3 generate bindings` manually.

```bash
task bindings
```

This ensures bindings are generated with the correct flags, output directory (`packages/omniviewdev-runtime/src/bindings`), and cleanup. The raw `wails3` command generates to the wrong location.

## Build & Test

```bash
GOWORK=off go build .           # Build the Go backend
GOWORK=off go test ./... -count=1  # Run all Go tests
task dev                        # Run the full app in dev mode
```

Use `GOWORK=off` for all Go commands — the module is not in the parent `go.work` file.

## Commits

- Do not add `Co-Authored-By` or any Claude attribution to commits or PRs.
