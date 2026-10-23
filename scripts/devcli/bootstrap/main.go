// Command bootstrap selects compilation inputs before loading devcli itself.
// Keep this entry standard-library-only: source selection and cache authority
// remain in devcli, which may import packages absent from the published SDK.
package main

import (
	"bytes"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type bootstrapOptions struct {
	root      string
	modfile   string
	sdkSource string
}

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

func run(args []string, output, diagnostics io.Writer) int {
	flags := flag.NewFlagSet("devcli-bootstrap", flag.ContinueOnError)
	flags.SetOutput(diagnostics)
	options := bootstrapOptions{}
	flags.StringVar(&options.root, "root", ".", "actual host source/module root")
	flags.StringVar(&options.modfile, "host-modfile", os.Getenv("GO_MODFILE"), "explicit effective host module input")
	flags.StringVar(&options.sdkSource, "sdk-source", os.Getenv("SDK_SOURCE"), "explicit reviewed absolute SDK source")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(diagnostics, "devcli-bootstrap: unexpected positional arguments")
		return 2
	}
	if err := bootstrap(context.Background(), options, output, diagnostics); err != nil {
		fmt.Fprintf(diagnostics, "devcli-bootstrap: %v\n", err)
		var exit *exec.ExitError
		if errors.As(err, &exit) && exit.ExitCode() > 0 {
			return exit.ExitCode()
		}
		return 1
	}
	return 0
}

func bootstrap(ctx context.Context, options bootstrapOptions, output, diagnostics io.Writer) (err error) {
	root, err := filepath.Abs(options.root)
	if err != nil {
		return err
	}
	compileSDK, err := compilationSDK(root, options.sdkSource)
	if err != nil {
		return err
	}
	selection := []string{"--root", root}
	if options.modfile != "" {
		selection = append(selection, "--host-modfile", options.modfile)
	}
	if options.sdkSource != "" {
		selection = append(selection, "--sdk-source", options.sdkSource)
	}
	// Always validate module selection before compiling any host-owned package.
	// This also rejects framework replacements when no explicit SDK is supplied.
	temporary, err := os.MkdirTemp("", "omniview-devcli-bootstrap-")
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, os.RemoveAll(temporary)) }()
	canonical, err := filepath.EvalSymlinks(temporary)
	if err != nil {
		return err
	}
	prepareArgs := append([]string{"run", filepath.Join(root, "scripts", "hostmod", "main.go")}, selection...)
	if options.sdkSource == "" && compileSDK != "" {
		prepareArgs = append(prepareArgs, "--sdk-source", compileSDK)
	}
	prepareArgs = append(prepareArgs, "--output-directory", canonical)
	prepareCommand := exec.CommandContext(ctx, "go", prepareArgs...)
	prepareCommand.Dir = root
	prepareCommand.Env = bootstrapGoEnvironment()
	var prepared bytes.Buffer
	prepareCommand.Stdout, prepareCommand.Stderr = &prepared, diagnostics
	if err := prepareCommand.Run(); err != nil {
		return fmt.Errorf("prepare SDK-aware bootstrap module: %w", err)
	}
	compileModfile := strings.TrimSpace(prepared.String())
	if !filepath.IsAbs(compileModfile) || filepath.Clean(compileModfile) != compileModfile || filepath.Dir(compileModfile) != canonical || filepath.Ext(compileModfile) != ".mod" {
		return errors.New("host preparation returned a module outside its owned output")
	}
	args := []string{"run"}
	if compileModfile != "" {
		args = append(args, "-modfile="+compileModfile)
	}
	args = append(args, filepath.Join(root, "scripts", "devcli"))
	args = append(args, selection...)
	command := exec.CommandContext(ctx, "go", args...)
	command.Dir = root
	command.Env = bootstrapGoEnvironment()
	command.Stdout, command.Stderr = output, diagnostics
	return command.Run()
}

func bootstrapGoEnvironment() []string {
	environment := make([]string, 0, len(os.Environ())+3)
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		switch key {
		case "GOWORK", "GOFLAGS", "GO_MODFILE", "GO111MODULE":
			continue
		}
		environment = append(environment, entry)
	}
	return append(environment, "GOWORK=off", "GOFLAGS=", "GO111MODULE=on")
}
