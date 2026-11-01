package main

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devworkspace"
	"github.com/spf13/cobra"
)

func addRepositoryCommands(root *cobra.Command) {
	group := &cobra.Command{Use: "repository", Short: "Manage source repositories"}
	for _, verb := range []string{"add", "remove", "list"} {
		var collection, id, path, ref, directory string
		var jsonOutput bool
		cmd := &cobra.Command{Use: verb + " [ID]", Short: "Repository " + verb}
		flags := cmd.Flags()
		flags.StringVar(&collection, "root", "", "repository collection root")
		flags.BoolVar(&jsonOutput, "json", false, "machine-readable result")
		if verb != "list" {
			flags.StringVar(&id, "id", "", "repository ID")
		}
		if verb == "add" {
			flags.StringVar(&path, "source", "", "existing local Git repository")
			flags.StringVar(&ref, "ref", "", "default Git ref")
			flags.StringVar(&directory, "directory", "", "workspace worktree directory")
		}
		cmd.RunE = func(cmd *cobra.Command, args []string) error {
			fail := func(err error) error {
				var typed *devcontract.Error
				if !errors.As(err, &typed) {
					typed = devcontract.Fail(5, "operation_failed", err.Error())
				}
				if jsonOutput {
					_ = json.NewEncoder(cmd.OutOrStdout()).Encode(map[string]any{"error": typed})
				} else {
					fmt.Fprintf(cmd.ErrOrStderr(), "%s: %s\n", typed.Code, typed.Message)
				}
				return commandExit(devcontract.ExitCode(typed))
			}
			if len(args) > 1 {
				return fail(devcontract.Fail(2, "usage", "at most one repository ID is accepted"))
			}
			if len(args) == 1 {
				if id != "" && id != args[0] {
					return fail(devcontract.Fail(4, "conflicting_target", "repository ID arguments disagree"))
				}
				id = args[0]
			}
			if verb != "list" && id == "" {
				return fail(devcontract.Fail(2, "usage", "repository ID is required"))
			}
			if verb == "list" && id != "" {
				return fail(devcontract.Fail(2, "usage", "repository list accepts no target"))
			}
			if verb == "add" && path == "" {
				return fail(devcontract.Fail(2, "usage", "repository add requires --source"))
			}
			collection, err := workspaceCollectionRoot(collection)
			if err != nil {
				return fail(err)
			}
			var value any
			switch verb {
			case "add":
				value, err = devworkspace.AddRepository(cmd.Context(), collection, devworkspace.SourceSpec{ID: id, Path: path, DefaultRef: ref, Directory: directory})
			case "remove":
				value, err = devworkspace.RemoveRepository(cmd.Context(), collection, id)
			case "list":
				value, err = devworkspace.LoadRegistry(cmd.Context(), collection)
			}
			if err != nil {
				return fail(err)
			}
			if jsonOutput {
				err = json.NewEncoder(cmd.OutOrStdout()).Encode(value)
			} else {
				printWorkspaceValue(cmd.OutOrStdout(), value)
			}
			if err != nil {
				return fail(err)
			}
			return nil
		}
		group.AddCommand(cmd)
	}
	root.AddCommand(group)
}
