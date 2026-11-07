// Command omniview-dev manages isolated local development workspaces.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// commandExitError carries an exit status after the command has written its result.
type commandExitError struct{ code int }

func (e *commandExitError) Error() string {
	return fmt.Sprintf("command exited with status %d", e.code)
}
func commandExit(code int) error {
	if code == 0 {
		return nil
	}
	return &commandExitError{code: code}
}

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }
func run(args []string, out, diagnostics io.Writer) int {
	return runWithInput(context.Background(), args, os.Stdin, out, diagnostics)
}

func newRootCommand(in io.Reader, out, diagnostics io.Writer) *cobra.Command {
	root := &cobra.Command{
		Use:           "omniview-dev",
		Short:         "Manage isolated development workspaces and their authenticated hosts",
		SilenceErrors: true,
		SilenceUsage:  true,
		Args:          cobra.NoArgs,
		RunE:          func(cmd *cobra.Command, _ []string) error { return cmd.Help() },
	}
	root.SetIn(in)
	root.SetOut(out)
	root.SetErr(diagnostics)
	// Cobra's raw flag errors may echo secret values. Emit safe usage diagnostics
	// centrally, including for errors raised before RunE or command validation.
	root.SetFlagErrorFunc(func(cmd *cobra.Command, err error) error {
		var name string
		var unknown *pflag.NotExistError
		var missing *pflag.ValueRequiredError
		var invalid *pflag.InvalidValueError
		switch {
		case errors.As(err, &unknown):
			// Only registered names are public. Unknown names can themselves
			// contain credentials, even when no flag value was supplied.
			if registeredFlag(root, unknown.GetSpecifiedName()) {
				name = unknown.GetSpecifiedName()
			}
		case errors.As(err, &missing):
			name = missing.GetFlag().Name
		case errors.As(err, &invalid):
			name = invalid.GetFlag().Name
		}
		message := "invalid command flags"
		if name != "" {
			message += ": --" + name
		}
		help := cmd.CommandPath() + " --help"
		failure := devcontract.Fail(2, "usage", message+"; inspect "+help+" for accepted flags and values")
		failure.Details = map[string]any{"helpCommand": help}
		if name != "" {
			failure.Details["flag"] = "--" + name
		}
		return failure
	})
	addWorkspaceCommands(root)
	addControlCommands(root, in)
	addViteFeedbackCommand(root)
	configureCommandGroups(root)
	return root
}

func registeredFlag(cmd *cobra.Command, name string) bool {
	if cmd.Flags().Lookup(name) != nil || cmd.PersistentFlags().Lookup(name) != nil {
		return true
	}
	for _, child := range cmd.Commands() {
		if registeredFlag(child, name) {
			return true
		}
	}
	return false
}

func configureCommandGroups(parent *cobra.Command) {
	for _, cmd := range parent.Commands() {
		if cmd.HasSubCommands() && cmd.Run == nil && cmd.RunE == nil {
			cmd.Args = cobra.NoArgs
			cmd.RunE = func(cmd *cobra.Command, _ []string) error { return cmd.Help() }
		}
		configureCommandGroups(cmd)
	}
}

// outputDelivery retains the first delivery failure, including invalid short
// writes, so every CLI path reports delivery failure without undoing mutations.
type outputDelivery struct {
	writer io.Writer
	err    error
}

func (w *outputDelivery) Write(p []byte) (int, error) {
	if w.err != nil {
		return 0, w.err
	}
	n, err := w.writer.Write(p)
	if err == nil && n != len(p) {
		err = io.ErrShortWrite
	}
	w.err = err
	return n, err
}

func runWithInput(ctx context.Context, args []string, in io.Reader, out, diagnostics io.Writer) (code int) {
	resultOutput := &outputDelivery{writer: out}
	diagnosticOutput := &outputDelivery{writer: diagnostics}
	out, diagnostics = resultOutput, diagnosticOutput
	defer func() {
		if resultOutput.err != nil || diagnosticOutput.err != nil {
			code = 5
		}
	}()
	root := newRootCommand(in, out, diagnostics)
	root.SetArgs(args)
	cmd, err := root.ExecuteContextC(ctx)
	if err == nil {
		return 0
	}
	var reported *commandExitError
	if errors.As(err, &reported) {
		return reported.code
	}
	if cmd == nil {
		cmd = root
	}
	var failure *devcontract.Error
	if !errors.As(err, &failure) {
		failure = devcontract.Fail(2, "usage", "invalid command or arguments")
	}
	if failure.Exit == 2 {
		parent := cmd
		// A leaf parse error needs its own help, not its parent's inventory.
		var commands []string
		for _, child := range parent.Commands() {
			if child.IsAvailableCommand() {
				commands = append(commands, child.Name())
			}
		}
		if len(commands) > 0 {
			failure.Message += "; valid commands: " + strings.Join(commands, " ")
		}
	}
	jsonOutput := wantsJSON(args)
	if jsonOutput || controlCommandOutput(cmd) {
		if json.NewEncoder(out).Encode(map[string]any{"error": failure}) != nil {
			return 5
		}
		if !jsonOutput {
			fmt.Fprintf(diagnostics, "%s: %s\n", failure.Code, failure.Message)
		}
	} else {
		fmt.Fprintf(diagnostics, "%s: %s\n", failure.Code, failure.Message)
		if failure.Exit == 2 {
			fmt.Fprint(diagnostics, cmd.UsageString())
		}
	}
	return devcontract.ExitCode(failure)
}

func controlCommandOutput(cmd *cobra.Command) bool {
	for cmd.Parent() != nil && cmd.Parent().Parent() != nil {
		cmd = cmd.Parent()
	}
	switch cmd.Name() {
	case "instance", "plugin", "settings", "operation", "extensions":
		return true
	default:
		return false
	}
}

// Output selection also works when parsing fails before Cobra reaches --json.
// Tokens after a terminator are positional values, never output flags.
func wantsJSON(args []string) bool {
	result := false
	for _, arg := range args {
		if arg == "--" {
			break
		}
		switch arg {
		case "--json", "--json=true":
			result = true
		case "--json=false":
			result = false
		}
	}
	return result
}
