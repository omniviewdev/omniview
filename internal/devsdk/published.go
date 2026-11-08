package devsdk

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"golang.org/x/mod/sumdb/dirhash"

	"github.com/omniviewdev/omniview/internal/devdiag"
)

// Runner runs one Go command ("go" plus args) in directory under the caller's
// process ownership and returns its standard output. Entries in environment are
// appended after the runner's own base environment, so they win. A failed
// command returns an error whose text carries bounded, sanitized diagnostics.
// Verification never starts a Go process of its own.
type Runner func(ctx context.Context, directory string, environment []string, args ...string) ([]byte, error)

// Consumer is a Go module whose effective plugin SDK dependency is observed.
type Consumer struct {
	// Name labels the consumer in diagnostics, normally its repository ID.
	Name string
	// Directory is the module root: the absolute clean directory holding go.mod
	// and go.sum, where Go commands run.
	Directory string
	// Modfile optionally names the absolute effective module file Go builds with
	// instead of Directory/go.mod, the host's generated host.mod. Its sum file is
	// the same path ending in .sum. It is verified in addition to Directory/go.mod
	// and must state the same SDK tuple.
	Modfile string
}

func (c Consumer) label() string {
	if c.Name != "" {
		return c.Name
	}
	return filepath.Base(c.Directory)
}

// ModuleEnvironment is appended to every published-SDK Go command, over the
// runner's base environment: no workspace file, no ambient GOFLAGS variable.
// Settings in the Go environment file are not masked by an empty variable: an
// empty GOFLAGS falls back to the file's value. Every command therefore passes
// -mod and -modfile explicitly, and the verifier refuses an effective GOFLAGS
// before it resolves anything (see CheckGoEnvironment). A published build
// that is not itself run by the verifier's runner appends this too.
func ModuleEnvironment() []string {
	return []string{"GOWORK=off", "GOFLAGS=", "GO111MODULE=on"}
}

// observation is what one published verification saw: the validated identity and
// the module-cache directory whose bytes were verified.
type observation struct {
	identity  Identity
	directory string
}

// listedModule is the part of `go list -m -json` the verification reads.
type listedModule struct {
	Path     string
	Version  string
	Dir      string
	GoMod    string
	Sum      string
	GoModSum string
	Main     bool
	Replace  *struct{ Path, Version string }
	Error    *struct{ Err string }
}

// resolver runs Go against a private copy of one consumer's effective module
// files. The consumer's own go.mod and go.sum are never passed to a command that
// can write them, so a download can never complete or edit them.
type resolver struct {
	run       Runner
	consumer  Consumer
	name      string
	modfile   string
	directory string
}

func newResolver(consumer Consumer, effective ModuleFiles, run Runner) (*resolver, func(), error) {
	directory, err := os.MkdirTemp("", "omniview-sdk-verify-")
	if err != nil {
		return nil, nil, err
	}
	cleanup := func() { _ = os.RemoveAll(directory) }
	modfile := filepath.Join(directory, "private.mod")
	if err = os.WriteFile(modfile, effective.GoMod, 0o600); err == nil {
		err = os.WriteFile(filepath.Join(directory, "private.sum"), effective.GoSum, 0o600)
	}
	if err != nil {
		cleanup()
		return nil, nil, err
	}
	return &resolver{run: run, consumer: consumer, name: consumer.label(), modfile: modfile, directory: directory}, cleanup, nil
}

// list resolves the SDK in the consumer's effective graph without editing any
// module file: -mod=readonly never writes, and the private copy is all it reads.
func (r *resolver) list(ctx context.Context, declared Published) (listedModule, error) {
	var listed listedModule
	output, err := r.run(ctx, r.consumer.Directory, ModuleEnvironment(), "list", "-mod=readonly", "-modfile="+r.modfile, "-m", "-json", Module)
	if err != nil {
		return listed, commandFailure(ctx, r.name, declared, err)
	}
	if err = json.Unmarshal(output, &listed); err != nil {
		return listed, dependencyUnavailable(r.name, declared, fmt.Errorf("unreadable go list response: %w", err))
	}
	if listed.Error != nil {
		return listed, commandFailure(ctx, r.name, declared, errors.New(listed.Error.Err))
	}
	if listed.Path != Module || listed.Main {
		return listed, contractMismatch(r.name, fmt.Sprintf("%s does not resolve %s as a required module", r.name, Module))
	}
	return listed, nil
}

// download fetches the exact module into the Go module cache, verified by Go
// against the private sum file. It writes only the private copy and the cache.
func (r *resolver) download(ctx context.Context, effective Published) error {
	output, err := r.run(ctx, r.consumer.Directory, ModuleEnvironment(), "mod", "download", "-modfile="+r.modfile, "-json", Module+"@"+effective.Version)
	if err != nil {
		return commandFailure(ctx, r.name, effective, err)
	}
	var downloaded struct{ Error string }
	if json.Unmarshal(output, &downloaded) == nil && downloaded.Error != "" {
		return commandFailure(ctx, r.name, effective, errors.New(downloaded.Error))
	}
	return nil
}

// AdmitDeclared applies policy to one complete published tuple and refuses it as
// an untrusted release (typed sdk_release_untrusted, joined to ErrNotAccepted)
// when it is not admitted. consumer labels the refusal. Callers that only read a
// consumer's declared tuple use it to report a refusal early; the verifier applies
// it to the declared and the effective tuples.
func AdmitDeclared(policy Policy, consumer string, published Published) error {
	identity, err := NewPublishedIdentity(published)
	if err != nil {
		return checksumsRequired(consumer, published, fmt.Sprintf("%s records no valid published SDK identity: %v", consumer, err), nil)
	}
	if err = policy.Admit(identity); err != nil {
		return releaseUntrusted(consumer, published, err)
	}
	return nil
}

func readConsumerFiles(directory string) (ModuleFiles, error) {
	var files ModuleFiles
	var err error
	if files.GoMod, err = os.ReadFile(filepath.Join(directory, "go.mod")); err != nil {
		return files, err
	}
	if files.GoSum, err = os.ReadFile(filepath.Join(directory, "go.sum")); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return files, err
	}
	if _, err = os.Lstat(filepath.Join(directory, "vendor")); err == nil {
		files.Vendored = true
	} else if !errors.Is(err, fs.ErrNotExist) {
		return files, err
	}
	return files, nil
}

// goflagsBound bounds the effective GOFLAGS copied into a refusal.
const goflagsBound = 256

// CheckGoEnvironment refuses a Go environment whose effective GOFLAGS is not
// empty, observed through the caller's runner under ModuleEnvironment. An empty
// GOFLAGS variable does not mask the Go environment file (`go env -w`, the file
// `go env GOENV` names): Go falls back to the file's value, so a user-level
// -overlay, -toolexec, -modfile or -mod=vendor there could change the SDK source
// that is compiled although only -mod=readonly is pinned. The refusal keeps the
// user's GOPRIVATE, GOPROXY, GOMODCACHE and checksum settings, which GOENV=off
// would have discarded. It runs before anything is resolved or downloaded, and a
// build that follows its verification in the same environment is covered by it.
// Verification and workspace preflight share this one check; it only reads.
func CheckGoEnvironment(ctx context.Context, consumer Consumer, declared Published, run Runner) error {
	name := consumer.label()
	output, err := run(ctx, consumer.Directory, ModuleEnvironment(), "env", "-json", "GOFLAGS")
	if err != nil {
		return commandFailure(ctx, name, declared, err)
	}
	var environment struct{ GOFLAGS string }
	if err = json.Unmarshal(output, &environment); err != nil {
		return dependencyUnavailable(name, declared, fmt.Errorf("unreadable go env response: %w", err))
	}
	flags := strings.TrimSpace(environment.GOFLAGS)
	if flags == "" {
		return nil
	}
	return GoFlagsRefusal(name, declared, flags)
}

// GoFlagsRefusal is the one typed refusal of a non-empty effective GOFLAGS,
// shared by the launch check (the go command's answer) and preflight (the Go
// environment file). flags is redacted and bounded here.
func GoFlagsRefusal(consumer string, declared Published, flags string) error {
	return buildEnvironmentConflict(consumer, declared, devdiag.Tail(devdiag.Redact(strings.TrimSpace(flags)), goflagsBound))
}

// CheckGoEnvironmentFile is the read-only, process-free preflight counterpart of
// CheckGoEnvironment: it parses the Go environment file (GOENV, "off" meaning
// none, else <user config dir>/go/env; KEY=VALUE lines, "#" comments, the last
// GOFLAGS line wins) and refuses a non-empty GOFLAGS there. The ambient GOFLAGS
// variable is not read: launch neutralizes it. A missing or unreadable file, an
// unresolvable config directory or an empty GOFLAGS is no refusal; launch's
// authoritative check still runs.
func CheckGoEnvironmentFile(consumer string, declared Published) error {
	path := os.Getenv("GOENV")
	if path == "off" {
		return nil
	}
	if path == "" {
		directory, err := os.UserConfigDir()
		if err != nil {
			return nil
		}
		path = filepath.Join(directory, "go", "env")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var flags string
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSuffix(line, "\r")
		if strings.TrimSpace(line) == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if key, value, found := strings.Cut(line, "="); found && key == "GOFLAGS" {
			flags = value
		}
	}
	if strings.TrimSpace(flags) == "" {
		return nil
	}
	return GoFlagsRefusal(consumer, declared, flags)
}

// observePublished identifies the published SDK a consumer's effective module
// graph selects, and refuses everything that makes that identity untrustworthy.
// An identity it returns is "verified" in exactly this sense: the extracted
// module-cache bytes hash (dirhash) to module and go.mod checksums the
// controller itself reviewed (the policy's table, not merely what the branch's
// go.sum says), and the module provides the Capability. Callers add the rest of
// the meaning: the compiled binary's Go buildinfo names exactly that version and
// sum with no replacement (VerifyBinary), and the identity was unchanged between
// a before and an after observation of the build. It does NOT claim that the
// SDK's behavior was reviewed for safety or sandboxing, that the executable's
// bytes were compiled from the hashed bytes (buildinfo is written by the go
// command, not measured), or that the toolchain or environment is trustworthy.
//
//  1. Static refusals from the consumer's own files (see Declare), applied to its
//     go.mod and, when given, to the explicit effective modfile.
//  2. The policy, on the declared tuple, before anything is resolved.
//  3. The Go environment: a non-empty effective GOFLAGS is refused before
//     anything is resolved (see CheckGoEnvironment).
//  4. The effective MVS-selected version and recorded checksums, resolved with
//     -mod=readonly against a private modfile copy under the caller's runner.
//  5. The module bytes: downloaded if absent, then hashed in place and compared
//     with the recorded module and go.mod checksums.
//  6. The capability the module's verified bytes must provide.
func observePublished(ctx context.Context, policy Policy, consumer Consumer, run Runner) (observation, error) {
	var none observation
	if run == nil {
		return none, errors.New("published SDK verification requires the caller's owned Go runner")
	}
	if !filepath.IsAbs(consumer.Directory) || filepath.Clean(consumer.Directory) != consumer.Directory {
		return none, fmt.Errorf("published SDK verification requires an absolute clean consumer directory: %q", consumer.Directory)
	}
	name := consumer.label()
	files, err := readConsumerFiles(consumer.Directory)
	if err != nil {
		return none, err
	}
	declared, err := Declare(name, files)
	if err != nil {
		return none, err
	}
	effective := files
	if consumer.Modfile != "" {
		if !filepath.IsAbs(consumer.Modfile) || !strings.HasSuffix(consumer.Modfile, ".mod") {
			return none, fmt.Errorf("the effective modfile must be an absolute path ending in .mod: %q", consumer.Modfile)
		}
		effective = ModuleFiles{}
		if effective.GoMod, err = os.ReadFile(consumer.Modfile); err != nil {
			return none, err
		}
		if effective.GoSum, err = os.ReadFile(strings.TrimSuffix(consumer.Modfile, ".mod") + ".sum"); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return none, err
		}
		generated, declareErr := Declare(name, effective)
		if declareErr != nil {
			return none, declareErr
		}
		if generated != declared {
			return none, selectionConflict(name, declared, fmt.Sprintf(
				"the effective module file of %s states a different plugin SDK tuple than its go.mod; refusing to build against it", name))
		}
	}
	if err = AdmitDeclared(policy, name, declared); err != nil {
		return none, err
	}
	if err = CheckGoEnvironment(ctx, consumer, declared, run); err != nil {
		return none, err
	}
	resolve, cleanup, err := newResolver(consumer, effective, run)
	if err != nil {
		return none, err
	}
	defer cleanup()
	listed, err := resolve.list(ctx, declared)
	if err != nil {
		return none, err
	}
	if listed.Replace != nil {
		return none, selectionConflict(name, declared, fmt.Sprintf("the effective module graph of %s replaces %s", name, Module))
	}
	resolved := Published{Module: Module, Version: listed.Version, ModuleSum: listed.Sum, GoModSum: listed.GoModSum}
	if resolved.Version != declared.Version {
		// MVS selected another version than the direct requirement: that
		// effective tuple is the one that must be trusted, never the declared one.
		if resolved.ModuleSum == "" || resolved.GoModSum == "" {
			return none, checksumsRequired(name, resolved, fmt.Sprintf(
				"%s/go.sum lacks the checksums of %s %s, the version its module graph selects; update go.sum in that repository's source branch",
				name, Module, resolved.Version), nil)
		}
		if err = AdmitDeclared(policy, name, resolved); err != nil {
			return none, err
		}
	} else if resolved != declared {
		return none, integrityMismatch(name, declared, fmt.Sprintf(
			"Go resolved checksums for %s %s that differ from those %s/go.sum records; refusing to trust either", Module, declared.Version, name), nil)
	}
	if listed.Dir == "" {
		if err = resolve.download(ctx, resolved); err != nil {
			return none, err
		}
		again, listErr := resolve.list(ctx, declared)
		if listErr != nil {
			return none, listErr
		}
		if again.Version != listed.Version || again.Sum != listed.Sum || again.GoModSum != listed.GoModSum {
			return none, IdentityChanged(name, fmt.Sprintf("the effective plugin SDK of %s changed while its module was downloaded", name))
		}
		if again.Dir == "" {
			return none, dependencyUnavailable(name, resolved, errors.New("the module directory is absent from the module cache after download"))
		}
		listed = again
	}
	if err = verifyModuleBytes(name, resolved, listed); err != nil {
		return none, err
	}
	if err = verifyCapability(listed.Dir); err != nil {
		return none, releaseUntrusted(name, resolved, fmt.Errorf("%w: the module does not provide the %s isolation capability: %v", ErrNotAccepted, Capability, err))
	}
	identity, err := NewPublishedIdentity(resolved)
	if err != nil {
		return none, err
	}
	return observation{identity: identity, directory: listed.Dir}, nil
}

// PublishedDirectory returns the module-cache directory Go resolves the SDK to
// for consumer, for read-only advisory scans after a successful verification.
// It is an observed build input, never selection authority, and is not itself a
// verification.
func PublishedDirectory(ctx context.Context, consumer Consumer, run Runner) (string, error) {
	if run == nil {
		return "", errors.New("resolving the published SDK requires the caller's owned Go runner")
	}
	files, err := readConsumerFiles(consumer.Directory)
	if err != nil {
		return "", err
	}
	declared, err := Declare(consumer.label(), files)
	if err != nil {
		return "", err
	}
	resolve, cleanup, err := newResolver(consumer, files, run)
	if err != nil {
		return "", err
	}
	defer cleanup()
	listed, err := resolve.list(ctx, declared)
	if err != nil {
		return "", err
	}
	if listed.Dir == "" {
		return "", dependencyUnavailable(consumer.label(), declared, errors.New("the module is not in the module cache"))
	}
	return listed.Dir, nil
}

// verifyModuleBytes compares the extracted module with the checksums Go
// recorded: the Go module cache never re-verifies an extracted directory, so a
// modified, extended or redirected entry is invisible to Go itself.
func verifyModuleBytes(consumer string, resolved Published, listed listedModule) error {
	sum, err := hashModuleDirectory(listed.Dir, Module+"@"+resolved.Version)
	if err != nil {
		return integrityMismatch(consumer, resolved, fmt.Sprintf(
			"the module cache entry of %s %s cannot be verified: %v; the shared module cache was not changed", Module, resolved.Version, err), nil)
	}
	if sum != resolved.ModuleSum {
		return integrityMismatch(consumer, resolved, fmt.Sprintf(
			"the module cache bytes of %s %s do not match the checksum %s/go.sum records; no launch or attestation, and the shared module cache was not changed",
			Module, resolved.Version, consumer), nil)
	}
	if listed.GoMod == "" {
		return integrityMismatch(consumer, resolved, fmt.Sprintf("the module cache has no go.mod file for %s %s", Module, resolved.Version), nil)
	}
	data, err := os.ReadFile(listed.GoMod)
	if err != nil {
		return integrityMismatch(consumer, resolved, fmt.Sprintf("the module cache go.mod of %s %s is unreadable: %v", Module, resolved.Version, err), nil)
	}
	goModSum, err := dirhash.Hash1([]string{"go.mod"}, func(string) (io.ReadCloser, error) {
		return io.NopCloser(bytes.NewReader(data)), nil
	})
	if err != nil || goModSum != resolved.GoModSum {
		return integrityMismatch(consumer, resolved, fmt.Sprintf(
			"the module cache go.mod of %s %s does not match the checksum %s/go.sum records", Module, resolved.Version, consumer), nil)
	}
	return nil
}

// hashModuleDirectory returns the h1: hash of every file below directory as a
// module zip would name them (prefix is module@version), refusing anything that
// is not a plain file or directory: a symlink or special entry could present
// other bytes than the ones hashed.
func hashModuleDirectory(directory, prefix string) (string, error) {
	var files []string
	paths := map[string]string{}
	err := filepath.WalkDir(directory, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(directory, path)
		if err != nil {
			return err
		}
		switch {
		case entry.IsDir():
			return nil
		case !entry.Type().IsRegular():
			return fmt.Errorf("%s is not a regular file", filepath.ToSlash(relative))
		}
		name := prefix + "/" + filepath.ToSlash(relative)
		files = append(files, name)
		paths[name] = path
		return nil
	})
	if err != nil {
		return "", err
	}
	return dirhash.Hash1(files, func(name string) (io.ReadCloser, error) { return os.Open(paths[name]) })
}

// verifyCapability checks that the verified module bytes provide the state-root
// isolation contract: the SDK's capability and module constants and the state
// root resolver and plugin-root opener the host's artifact gate relies on. Names
// are read from parsed source, never executed, and the bytes were already
// matched to the recorded checksums.
func verifyCapability(directory string) error {
	constants, _, err := declarations(filepath.Join(directory, "pkg", "config", "isolation.go"))
	if err != nil {
		return err
	}
	if constants["StateIsolationCapability"] != Capability {
		return fmt.Errorf("pkg/config/isolation.go does not declare StateIsolationCapability = %q", Capability)
	}
	if constants["StateIsolationSDKModule"] != Module {
		return fmt.Errorf("pkg/config/isolation.go does not declare StateIsolationSDKModule = %q", Module)
	}
	_, functions, err := declarations(filepath.Join(directory, "pkg", "state", "root.go"))
	if err != nil {
		return err
	}
	for _, required := range []string{"ResolveRoot", "OpenPluginRoot"} {
		if !functions[required] {
			return fmt.Errorf("pkg/state/root.go does not declare %s", required)
		}
	}
	return nil
}

// declarations returns the string constants and top-level function names a Go
// file declares.
func declarations(path string) (constants map[string]string, functions map[string]bool, err error) {
	source, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, err
	}
	file, err := parser.ParseFile(token.NewFileSet(), path, source, parser.SkipObjectResolution)
	if err != nil {
		return nil, nil, err
	}
	constants, functions = map[string]string{}, map[string]bool{}
	for _, declaration := range file.Decls {
		switch declared := declaration.(type) {
		case *ast.FuncDecl:
			if declared.Recv == nil {
				functions[declared.Name.Name] = true
			}
		case *ast.GenDecl:
			if declared.Tok != token.CONST {
				continue
			}
			for _, spec := range declared.Specs {
				value := spec.(*ast.ValueSpec)
				for index, name := range value.Names {
					if index >= len(value.Values) {
						continue
					}
					if literal, ok := value.Values[index].(*ast.BasicLit); ok && literal.Kind == token.STRING {
						if unquoted, unquoteErr := strconv.Unquote(literal.Value); unquoteErr == nil {
							constants[name.Name] = unquoted
						}
					}
				}
			}
		}
	}
	return constants, functions, nil
}
