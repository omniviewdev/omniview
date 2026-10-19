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
	compileModfile := options.modfile
	if compileSDK != "" {
		var temporary string
		temporary, err = os.MkdirTemp("", "omniview-devcli-bootstrap-")
		if err != nil {
			return err
		}
		defer func() { err = errors.Join(err, os.RemoveAll(temporary)) }()
		canonical, pathErr := filepath.EvalSymlinks(temporary)
		if pathErr != nil {
			return pathErr
		}
		args := append([]string{"run", filepath.Join(root, "scripts", "nativepatch", "main.go")}, selection...)
		if options.sdkSource == "" {
			args = append(args, "--sdk-source", compileSDK)
		}
		args = append(args, "--output-directory", canonical)
		command := exec.CommandContext(ctx, "go", args...)
		command.Dir = root
		var prepared bytes.Buffer
		command.Stdout, command.Stderr = &prepared, diagnostics
		if err := command.Run(); err != nil {
			return fmt.Errorf("prepare explicit SDK bootstrap module: %w", err)
		}
		compileModfile = strings.TrimSpace(prepared.String())
		if !filepath.IsAbs(compileModfile) || filepath.Clean(compileModfile) != compileModfile || filepath.Dir(compileModfile) != canonical || filepath.Ext(compileModfile) != ".mod" {
			return errors.New("native preparation returned a module outside its owned output")
		}
	}
	args := []string{"run"}
	if compileModfile != "" {
		args = append(args, "-modfile="+compileModfile)
	}
	args = append(args, filepath.Join(root, "scripts", "devcli"))
	args = append(args, selection...)
	command := exec.CommandContext(ctx, "go", args...)
	command.Dir = root
	command.Stdout, command.Stderr = output, diagnostics
	return command.Run()
}
