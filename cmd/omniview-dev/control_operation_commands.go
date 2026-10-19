package main

import (
	"flag"

	"github.com/omniviewdev/omniview/internal/devcontrol"
)

func parseOperationControlCommand(command *controlCommand, flags *flag.FlagSet, args []string) error {
	switch command.operation {
	case "operation.get", "operation.wait":
	default:
		return controlUsage("unknown control command")
	}
	var id string
	flags.StringVar(&id, "id", "", "operation ID")
	positionals, err := parseControlFlags(command, flags, args)
	if err != nil {
		return err
	}
	id, err = controlTarget(id, positionals, "ID arguments disagree")
	if err != nil {
		return err
	}
	if err := requireControlID(id); err != nil {
		return err
	}
	command.params = devcontrol.OperationParams{OperationID: id}
	return nil
}
