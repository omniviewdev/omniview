package main

import (
	"time"

	"github.com/spf13/pflag"

	"github.com/omniviewdev/omniview/backend/extensiondiagnostics"
	"github.com/omniviewdev/omniview/internal/devcontrol"
)

func bindExtensionControlCommand(command *controlCommand, flags *pflag.FlagSet) func([]string) error {
	if command.operation == "extensions.windows" {
		return func(args []string) error {
			if len(args) != 0 {
				return controlUsage("extensions windows accepts no positional arguments")
			}
			command.params = devcontrol.EmptyParams{}
			return nil
		}
	}
	params := devcontrol.ExtensionParams{WindowName: "main"}
	flags.StringVar(&params.WindowName, "window", "main", "live frontend window name")
	flags.StringVar(&params.PluginID, "plugin", "", "plugin ID")
	flags.StringVar(&params.PointID, "point", "", "extension point ID")
	flags.BoolVar(&command.includeSensitive, "include-sensitive", false, "include bounded raw errors and stacks; may expose secrets")
	operation := "snapshot"
	if command.operation == "extensions.lookup" {
		operation = "lookup"
		flags.StringVar(&params.ResourceKey, "resource-key", "", "resource context key (required; executes plugin matchers)")
	} else {
		flags.BoolVar(&params.IssuesOnly, "issues-only", false, "show only entries with diagnostic issues")
		flags.StringVar(&params.Query, "query", "", "filter inventory text without running matchers")
	}
	return func(args []string) error {
		if len(args) != 0 {
			return controlUsage("extension diagnostics accept no positional arguments")
		}
		params.IncludeSensitive = command.includeSensitive
		if !extensiondiagnostics.ValidRequest(params.WindowName, operation, params.Options) {
			if operation == "lookup" {
				return controlUsage("extensions lookup requires --point, --plugin, and --resource-key with a valid --window")
			}
			return controlUsage("extension diagnostics require valid bounded filters and a nonempty --window")
		}
		params.TimeoutMS = int((command.timeout + time.Millisecond - 1) / time.Millisecond)
		command.params = params
		return nil
	}
}
