package main

import (
	"encoding/json"
	"flag"
	"io"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devcontrol"
)

func parseSettingsControlCommand(command *controlCommand, flags *flag.FlagSet, args []string, in io.Reader) error {
	var scope, plugin, id, value, values string
	switch command.operation {
	case "settings.schema", "settings.get", "settings.set", "settings.set-many":
	default:
		return controlUsage("unknown control command")
	}
	flags.StringVar(&scope, "scope", "host", "host or plugin")
	flags.StringVar(&plugin, "plugin", "", "plugin ID for plugin settings")
	if command.operation != "settings.schema" {
		flags.StringVar(&id, "id", "", "setting ID")
	}
	if command.operation == "settings.set" {
		flags.StringVar(&value, "value", "", "one JSON value; - reads stdin")
	}
	if command.operation == "settings.set-many" {
		flags.StringVar(&values, "values", "", "JSON object; - reads stdin")
	}
	positionals, err := parseControlFlags(command, flags, args)
	if err != nil {
		return err
	}
	id, err = controlTarget(id, positionals, "ID arguments disagree")
	if err != nil {
		return err
	}
	if scope != "host" && scope != "plugin" || scope == "plugin" && plugin == "" || scope == "host" && plugin != "" {
		return controlUsage("settings scope must be host, or plugin with --plugin ID")
	}
	params := devcontrol.SettingsParams{Scope: scope, PluginID: plugin, ID: id}
	switch command.operation {
	case "settings.schema":
		if len(positionals) > 0 {
			return controlUsage("settings schema accepts no ID")
		}
	case "settings.set":
		if id == "" || value == "" {
			return controlUsage("settings set requires --id and --value JSON (or -)")
		}
		raw, err := readControlJSON(value, in)
		if err != nil {
			return err
		}
		params.Value = raw
	case "settings.set-many":
		if id != "" || values == "" {
			return controlUsage("settings set-many requires --values JSON object (or -), without --id")
		}
		raw, err := readControlJSON(values, in)
		if err != nil {
			return err
		}
		if err = json.Unmarshal(raw, &params.Values); err != nil || params.Values == nil {
			return controlUsage("settings values must be a JSON object")
		}
		command.operation = "settings.bulk"
	}
	command.params = params
	return nil
}

func readControlJSON(value string, in io.Reader) (json.RawMessage, error) {
	data := []byte(value)
	if value == "-" {
		if in == nil {
			return nil, devcontract.Fail(2, "invalid_params", "JSON stdin is required")
		}
		var err error
		data, err = io.ReadAll(io.LimitReader(in, 1<<20+1))
		if err != nil {
			return nil, devcontract.Fail(2, "invalid_params", "cannot read JSON stdin")
		}
	}
	if len(data) > 1<<20 || !json.Valid(data) {
		return nil, devcontract.Fail(2, "invalid_params", "settings require one valid JSON value, at most 1 MiB")
	}
	return json.RawMessage(data), nil
}
