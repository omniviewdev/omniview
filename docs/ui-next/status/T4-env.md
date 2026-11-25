# Status: T4-env (`launch.env` on CreateTerminal, issue #695 step 1)

- Agent: LaunchEnv. Worktree `~/omniview/wt/t695-env`, branch `feat/terminal-launch-env` on `origin/main` `79f4ffe0`. Epic #692.
- Owned: `backend/pkg/terminal/{types,env,manager,errors}.go` (create path only) and `launch_env_test.go`, `backend/pkg/plugin/exec/service_wrapper.go` (one field, both lanes), the regenerated bindings, `T1-go.md` 2.1, this file and `T4-env/mutations.sh.txt`.

## Decisions

- Field: `Launch.Env map[string]string` (`env` on the wire), `Options.Env`. Validated in `Manager.Start` before the id is reserved or anything is opened: a refusal starts nothing and announces nothing.
- The refusal list is the host's strip list, one source: `reservedEnvName` = `hostPrivate` (what the shell never inherits) + `ownEnvironment` (what the terminal sets: `TERM`, `COLORTERM`, `TERM_PROGRAM`, `TERM_PROGRAM_VERSION`, `PWD`, `SHELL`). `terminalEnvironment` reads the same table. A test asserts every strip-list name is refused.
- Bounds: name 256 bytes, value 32 KiB (`MaxEnvValue`), 64 entries, 256 KiB of names and values in all. Bounds are inclusive (tested at the bound and one over). Reason: a 32 KiB value is under Linux's 128 KiB per-string limit; the total keeps the whole environment far under ARG_MAX (macOS 1 MiB).
- Error: `INVALID_REQUEST` / `omniview:validation` / 400, the shape of `cwd` (T1-go 2.5): the detail names `launch.env.<NAME>`; `launch.env` for a name that is not a name (the name is quoted and cut at 64 bytes). Names are read sorted, so the answer is stable. No value is ever in the text (tested with a canary value in every case).
- `ZDOTDIR`, `XDG_DATA_DIRS`: allowed, not refused. The launch env is merged into the base environment before the shell integration plans, so `originalOf` reads the given value as the user's and the shim gives it back. Tested with zsh (the user's `.zshrc` in the given directory ran, `ZDOTDIR` is the given one afterwards, the integration is `on`, marks reach the scanner). The fish twin is written and skipped here (no fish on this machine: NOT RUN).
- `PATH` is allowed. The login shell's own files may replace it (`/etc/profile` on Debian does), so no test claims it survives; `launch.env` is not the login environment (T1-go 2.8.1).
- Canary: `WAILS_MCP_TOKEN` in the host's environment and in `launch.env` together: refused, and without `launch.env` it is still stripped.

## Checks run

- `go test -race -count=3` on the launch.env tests and the neighbours (PATH order, strip list, PWD): ok. The whole terminal package once with `-race` and the exec package once: ok.
- Controls, both halves: `bash docs/ui-next/status/T4-env/mutations.sh.txt`: a stripped name accepted, a value over the bound, a name with `=`, a value echoed in the error, launch.env never applied: each red in exactly the tests named, and green with them skipped.
- golangci-lint v2.15.0 in CI's form on the terminal and exec packages: 0 issues. `task check:bindings-check`: no diff. `GOOS=windows go vet` and `GOOS=darwin go vet` on terminal and exec: clean.

## Not verified

- The fish twin of the ZDOTDIR test (`XDG_DATA_DIRS`): no fish here, skipped (NOT RUN).
- Wrapper wiring (`launch.env` on the Wails call through `ServiceWrapper.CreateTerminal`, both lanes) has no test of its own; it is one field in each `terminal.Options`.
- macOS: not run. The page: not touched.
