package main

import (
	"github.com/spf13/pflag"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devcontrol"
)

func bindPluginControlCommand(command *controlCommand, flags *pflag.FlagSet) func([]string) error {
	var id, path, version, generation string
	var cursor, limit int
	switch command.operation {
	case "plugin.list":
	case "plugin.get", "plugin.uninstall", "plugin.dev.unlink", "plugin.dev.start", "plugin.dev.stop", "plugin.dev.restart", "plugin.dev.status":
		flags.StringVar(&id, "id", "", "plugin ID")
	case "plugin.install-archive", "plugin.dev.link":
		flags.StringVar(&path, "path", "", "archive or plugin source path")
	case "plugin.install-version":
		flags.StringVar(&id, "id", "", "plugin ID")
		flags.StringVar(&version, "version", "", "exact plugin version")
	case "plugin.dev.rebuild":
		flags.StringVar(&id, "id", "", "plugin ID")
		flags.StringVar(&generation, "generation", "", "expected plugin generation")
	case "plugin.dev.logs":
		flags.StringVar(&id, "id", "", "plugin ID")
		flags.IntVar(&cursor, "cursor", 0, "log cursor")
		flags.IntVar(&limit, "limit", 100, "maximum log records (1..500)")
		flags.BoolVar(&command.unsafeOutput, "unsafe-output", false, "include raw potentially sensitive plugin/build output in JSON stdout")
	default:
		panic("unknown control command")
	}
	return func(positionals []string) error {
		var err error
		switch command.operation {
		case "plugin.list":
			if len(positionals) != 0 {
				return controlUsage("this command accepts no positional target")
			}
			command.params = devcontrol.EmptyParams{}
			return nil
		case "plugin.install-archive", "plugin.dev.link":
			path, err = controlTarget(path, positionals, "path arguments disagree")
			if err != nil {
				return err
			}
			if path == "" {
				return controlUsage("--path is required")
			}
			canonical, err := devcontract.CanonicalPath(path)
			if err != nil {
				return err
			}
			command.params = devcontrol.PathParams{Path: canonical}
			return nil
		}
		id, err = controlTarget(id, positionals, "ID arguments disagree")
		if err != nil {
			return err
		}
		if err := requireControlID(id); err != nil {
			return err
		}
		switch command.operation {
		case "plugin.install-version":
			if version == "" {
				return controlUsage("--version is required")
			}
			command.params = devcontrol.VersionParams{ID: id, Version: version}
		case "plugin.dev.rebuild":
			if generation == "" {
				return controlUsage("--generation is required; use plugin dev status to obtain the plugin generation")
			}
			command.params = devcontrol.RebuildParams{ID: id, Generation: generation}
		case "plugin.dev.logs":
			if cursor < 0 || limit < 1 || limit > 500 {
				return controlUsage("cursor must be nonnegative and limit must be 1..500")
			}
			command.params = devcontrol.LogsParams{ID: id, Cursor: cursor, Limit: limit, IncludeOutput: command.unsafeOutput}
		default:
			command.params = devcontrol.PluginParams{ID: id}
		}
		return nil
	}
}
