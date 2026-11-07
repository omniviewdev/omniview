package main

import (
	"github.com/spf13/pflag"

	"github.com/omniviewdev/omniview/internal/devcontrol"
)

func bindOperationControlCommand(command *controlCommand, flags *pflag.FlagSet) func([]string) error {
	switch command.operation {
	case "operation.get", "operation.wait":
	default:
		panic("unknown control command")
	}
	var id string
	flags.StringVar(&id, "id", "", "operation ID")
	if command.operation == "operation.get" {
		flags.BoolVar(&command.unsafeOutput, "unsafe-output", false, "include bounded raw operation diagnostics; may contain secrets")
	}
	return func(positionals []string) error {
		var err error
		id, err = controlTarget(id, positionals, "ID arguments disagree")
		if err != nil {
			return err
		}
		if err := requireControlID(id); err != nil {
			return err
		}
		command.params = devcontrol.OperationParams{OperationID: id, IncludeOutput: command.unsafeOutput}
		return nil
	}
}
