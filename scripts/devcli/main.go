// Command devcli builds the host-owned workspace CLI into a private external
// content-addressed cache. Its stdout is only the actual immutable executable.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
)

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }
func run(args []string, output, diagnostics io.Writer) int {
	flags := flag.NewFlagSet("devcli", flag.ContinueOnError)
	flags.SetOutput(diagnostics)
	options := inputOptions{}
	flags.StringVar(&options.root, "root", ".", "actual host source/module root")
	flags.StringVar(&options.modfile, "host-modfile", os.Getenv("GO_MODFILE"), "explicit effective host module input")
	flags.StringVar(&options.sdkSource, "sdk-source", os.Getenv("SDK_SOURCE"), "explicit reviewed absolute SDK source")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(diagnostics, "devcli: unexpected positional arguments")
		return 2
	}
	binary, err := bootstrapCLI(context.Background(), options, diagnostics)
	if err != nil {
		fmt.Fprintf(diagnostics, "devcli: %v\n", err)
		return devcontract.ExitCode(err)
	}
	fmt.Fprintln(output, binary)
	return 0
}

func goEnvironment(cache, temporary string) []string {
	inherited := os.Environ()
	environment := make([]string, 0, len(inherited)+8)
	for _, entry := range inherited {
		key, _, _ := strings.Cut(entry, "=")
		switch key {
		case "GOWORK", "GOFLAGS", "GO_MODFILE", "GO111MODULE", "GOOS", "GOARCH", "CGO_ENABLED", "GOCACHE", "GOTMPDIR":
			continue
		}
		environment = append(environment, entry)
	}
	environment = append(environment, "GOWORK=off", "GOFLAGS=", "GO111MODULE=on", "GOOS="+runtime.GOOS, "GOARCH="+runtime.GOARCH, "CGO_ENABLED=0", "GOCACHE="+cache, "GOTMPDIR="+temporary)
	return environment
}

func externalCache(ctx context.Context, selected selectedInputs) (string, string, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		return "", "", err
	}
	base, err = devcontract.CanonicalPath(base)
	if err != nil {
		return "", "", err
	}
	root := filepath.Join(base, cacheKind)
	canonical, err := validateCacheLocation(root, selected, true)
	if err != nil {
		return "", "", err
	}
	if canonical != root {
		return "", "", fmt.Errorf("CLI tool-cache namespace is redirected: %s", root)
	}
	cache := os.Getenv("GOCACHE")
	if cache == "" {
		cache = filepath.Join(base, "go-build")
	}
	if !filepath.IsAbs(cache) {
		return "", "", fmt.Errorf("Go build cache must be an absolute external directory")
	}
	cache, err = validateCacheLocation(cache, selected, false)
	if err != nil {
		return "", "", err
	}
	// The OS cache container may be readable (for example ~/Library/Caches), but
	// an unrelated Unix principal must not be able to replace its private child.
	if err := os.MkdirAll(base, 0700); err != nil {
		return "", "", err
	}
	info, err := os.Lstat(base)
	if err != nil {
		return "", "", err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || (runtime.GOOS != "windows" && info.Mode().Perm()&0022 != 0) {
		return "", "", fmt.Errorf("unsafe OS user-cache container: %s", base)
	}
	if err := createCacheNamespace(ctx, root); err != nil {
		return "", "", err
	}
	return root, cache, nil
}

func executeGo(ctx context.Context, selected selectedInputs, environment []string, diagnostics io.Writer, args ...string) error {
	command := exec.CommandContext(ctx, "go", args...)
	command.Dir = selected.root
	command.Env = environment
	command.Stdout = diagnostics
	command.Stderr = diagnostics
	return command.Run()
}

func prepareHost(ctx context.Context, paths cachePaths, fresh bool, selected selectedInputs, environment []string, diagnostics io.Writer) (hostReply, error) {
	var prior hostRecord
	if !fresh {
		if err := devsession.ReadPrivateJSON(paths.hostRecord, &prior); err != nil {
			return hostReply{}, fmt.Errorf("refusing incomplete host module CLI cache %s: %w", paths.directory, err)
		}
		if err := validateHostRecord(paths, prior); err != nil {
			return hostReply{}, err
		}
	}
	args := []string{"run", filepath.Join(selected.root, "scripts", "hostmod", "main.go"), "--root", selected.root, "--host-modfile", paths.inputMod, "--output-directory", paths.host, "--format", "json"}
	if selected.sdkSource != "" {
		args = append(args, "--sdk-source", selected.sdkSource)
	}
	command := exec.CommandContext(ctx, "go", args...)
	command.Dir = selected.root
	command.Env = environment
	command.Stderr = diagnostics
	raw, err := command.Output()
	if err != nil {
		return hostReply{}, fmt.Errorf("prepare effective host module: %w", err)
	}
	var reply hostReply
	if err := json.Unmarshal(raw, &reply); err != nil {
		return reply, fmt.Errorf("decode host module result: %w", err)
	}
	state := hostRecord{SchemaVersion: 1, Output: reply}
	state.ModuleSHA256, err = hashPrivateFile(reply.Modfile)
	if err != nil {
		return reply, err
	}
	state.SumSHA256, err = hashPrivateFile(strings.TrimSuffix(reply.Modfile, ".mod") + ".sum")
	if err != nil {
		return reply, err
	}
	if err := validateHostRecord(paths, state); err != nil {
		return reply, err
	}
	if fresh {
		if err := writeNewJSON(paths.hostRecord, state); err != nil {
			return reply, err
		}
	} else if state != prior {
		return reply, fmt.Errorf("host module CLI cache changed despite immutable input identity: %s", paths.directory)
	}
	return reply, nil
}

func bootstrapCLI(ctx context.Context, options inputOptions, diagnostics io.Writer) (binary string, resultErr error) {
	selected, err := selectInputs(options)
	if err != nil {
		return "", err
	}
	key, err := hostInputKey(selected)
	if err != nil {
		return "", err
	}
	root, cache, err := externalCache(ctx, selected)
	if err != nil {
		return "", err
	}
	lockName := "input-" + key + ".lock"
	if info, err := os.Lstat(filepath.Join(root, lockName)); err == nil {
		if !info.Mode().IsRegular() || info.Size() != 0 {
			return "", fmt.Errorf("CLI cache lock is an unknown file")
		}
	} else if !os.IsNotExist(err) {
		return "", err
	}
	lock, err := devsession.AcquirePrivateLock(ctx, root, lockName)
	if err != nil {
		return "", err
	}
	defer func() { resultErr = errors.Join(resultErr, lock.Close()) }()
	paths, fresh, err := claimInputs(root, key, selected)
	if err != nil {
		return "", err
	}
	discardClaim := fresh
	defer func() {
		if discardClaim && resultErr != nil {
			resultErr = errors.Join(resultErr, removeBuildStage(paths.directory, paths.initialDirectory))
		}
	}()
	stage, err := os.MkdirTemp(paths.directory, ".build-")
	if err != nil {
		return "", err
	}
	canonical, err := devsession.EnsurePrivateDirectory(stage)
	if err != nil {
		return "", err
	}
	if canonical != stage {
		return "", fmt.Errorf("new CLI build stage redirected")
	}
	original, err := os.Lstat(stage)
	if err != nil {
		return "", err
	}
	defer func() {
		cleanupErr := removeBuildStage(stage, original)
		if cleanupErr != nil {
			discardClaim = false
		}
		resultErr = errors.Join(resultErr, cleanupErr)
	}()
	temporary := filepath.Join(stage, "tmp")
	if created, err := makePrivateDirectory(temporary); err != nil {
		return "", err
	} else if !created {
		return "", fmt.Errorf("new CLI stage contains an unknown temporary directory")
	}
	environment := goEnvironment(cache, temporary)
	host, err := prepareHost(ctx, paths, fresh, selected, environment, diagnostics)
	if err != nil {
		return "", err
	}
	// Host-module publication ends fresh-claim rollback. A later build failure
	// retains this valid immutable template for the next real Go source check.
	discardClaim = false
	buildMod, err := cloneBuildModule(host.Modfile, stage)
	if err != nil {
		return "", err
	}
	stagedBinary := filepath.Join(stage, executableName())
	// Always execute Go's real source/action-cache check. A metadata-only cache
	// hit must not reuse a stale CLI after host or SDK source code changes.
	if err := executeGo(ctx, selected, environment, diagnostics, "build", "-modfile="+buildMod, "-mod=mod", "-tags=server", "-trimpath", "-buildvcs=false", "-o", stagedBinary, "./cmd/omniview-dev"); err != nil {
		return "", fmt.Errorf("build workspace CLI (a compatible reviewed SDK_SOURCE or workspace-linked SDK is required): %w", err)
	}
	if runtime.GOOS != "windows" {
		if err := os.Chmod(stagedBinary, 0500); err != nil {
			return "", err
		}
	}
	if err := validateExecutable(stagedBinary); err != nil {
		return "", err
	}
	// Go may edit only the private clone. The immutable host module template must
	// still match its independently recorded contents after compilation.
	var hostState hostRecord
	if err := devsession.ReadPrivateJSON(paths.hostRecord, &hostState); err != nil {
		return "", err
	}
	if err := validateHostRecord(paths, hostState); err != nil {
		return "", err
	}
	return publishArtifact(paths.binaries, stagedBinary, key)
}
