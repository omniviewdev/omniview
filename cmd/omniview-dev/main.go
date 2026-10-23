// Command omniview-dev manages isolated local development workspaces.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"

	"github.com/omniviewdev/omniview/internal/devcontract"
)

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }
func run(args []string, out, diagnostics io.Writer) int {
	if handled, code := handleViteFeedbackRead(args, out, diagnostics); handled {
		return code
	}
	ctx := context.Background()
	if handled, code := HandleControlCommand(ctx, args, os.Stdin, out, diagnostics); handled {
		return code
	}
	if handled, code := HandleWorkspaceCommand(ctx, args, out, diagnostics); handled {
		return code
	}
	if len(args) == 0 || args[0] == "help" || args[0] == "--help" {
		fmt.Fprintln(out, "Usage: omniview-dev workspace <command> [NAME | --workspace PATH] [--root COLLECTION] [--json]\nCommands: init create up down restart edit link unlink remove inspect list paths profile resume rollback\nCreate: --repo ID --plugin ID --ref ID=REF (repeatable), --start\nLaunch: --mode browser|native --reviewed-sdk-revision FULL --link-evidence FILE [--mcp] [--watch=false] [--live-frontend=false]\n        [--allow-isolation-source-changes] [--seed-from STATE_ROOT --seed-version VERSION] [--timeout 20m]\n       omniview-dev instance|plugin|settings|operation <command> [options]\nSee docs/development-cli.md and docs/development-workspaces.md.")
		return 0
	}
	_ = json.NewEncoder(out).Encode(map[string]any{"error": devcontract.Fail(2, "usage", "unknown command; use --help")})
	return 2
}
