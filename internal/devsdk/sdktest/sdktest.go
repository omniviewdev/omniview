// Package sdktest builds hermetic Go module worlds for tests of published-SDK
// handling: a scratch module cache and a file:// module proxy that serve real
// plugin SDK releases. The releases are derived from the SDK this repository
// itself is pinned to, so no test needs the network or a particular
// developer-machine cache, and no test touches the shared module cache.
package sdktest

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"

	"golang.org/x/mod/module"
	"golang.org/x/mod/sumdb/dirhash"
	"golang.org/x/mod/zip"

	"github.com/omniviewdev/omniview/internal/devsdk"
)

// Release is one served module version and the checksums go.sum records for it.
type Release struct {
	Module    string
	Version   string
	ModuleSum string
	GoModSum  string
}

// Published returns the release as a published SDK tuple.
func (r Release) Published() devsdk.Published {
	return devsdk.Published{Module: r.Module, Version: r.Version, ModuleSum: r.ModuleSum, GoModSum: r.GoModSum}
}

// World is a scratch module cache plus a file:// module proxy.
type World struct {
	t        testing.TB
	Root     string
	Proxy    string
	ModCache string

	mu       sync.Mutex
	commands [][]string
}

// New creates an empty world. Its module cache is writable again when the test
// ends, because the Go command extracts modules read-only.
func New(t testing.TB) *World {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	world := &World{t: t, Root: root, Proxy: filepath.Join(root, "proxy"), ModCache: filepath.Join(root, "modcache")}
	for _, directory := range []string{world.Proxy, world.ModCache} {
		if err = os.MkdirAll(directory, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() { makeWritable(world.ModCache) })
	return world
}

func makeWritable(root string) {
	_ = filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err == nil {
			_ = os.Chmod(path, 0o700)
		}
		return nil
	})
}

// Environment is the environment of every Go command run inside the world:
// the scratch cache and proxy, no checksum database, no private-module patterns
// and no Go environment file. GOFLAGS carries -modcacherw like the e2e harness.
func (w *World) Environment() []string {
	return []string{
		"GOENV=off", "GOMODCACHE=" + w.ModCache, "GOPROXY=file://" + w.Proxy, "GOSUMDB=off",
		"GOPRIVATE=", "GONOPROXY=", "GONOSUMDB=", "GOINSECURE=", "GOFLAGS=-modcacherw",
		"GOTOOLCHAIN=local", "GOWORK=off",
	}
}

// Commands returns every Go command the world's runner has been asked to run.
func (w *World) Commands() [][]string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return append([][]string(nil), w.commands...)
}

// Runner returns a devsdk.Runner that runs go under the world's environment,
// appended after the ambient one like a production owned runner, and records
// every command. A failed command's error carries its combined output.
func (w *World) Runner() devsdk.Runner {
	return func(ctx context.Context, directory string, environment []string, args ...string) ([]byte, error) {
		w.mu.Lock()
		w.commands = append(w.commands, append([]string(nil), args...))
		w.mu.Unlock()
		cmd := exec.CommandContext(ctx, "go", args...)
		cmd.Dir = directory
		cmd.Env = append(append(os.Environ(), w.Environment()...), environment...)
		var stdout, stderr bytes.Buffer
		cmd.Stdout, cmd.Stderr = &stdout, &stderr
		if err := cmd.Run(); err != nil {
			return nil, fmt.Errorf("go %s: %w\n%s%s", strings.Join(args, " "), err, stdout.String(), stderr.String())
		}
		return stdout.Bytes(), nil
	}
}

// ambientModCache is the module cache this test binary started with. Tests move
// HOME and GOMODCACHE into scratch worlds; the repository's pinned releases still
// live here, so resolving them never depends on the environment at call time.
var ambientModCache = func() string {
	output, err := exec.Command("go", "env", "GOMODCACHE").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}()

// PinnedSDK returns the extracted directory of the plugin SDK release this
// repository is pinned to, from the ambient module cache.
func PinnedSDK(t testing.TB) string { return pinnedModule(t, devsdk.Module).Dir }

// pinnedModule resolves a module of this repository's build list.
func pinnedModule(t testing.TB, path string) (listed struct{ Dir, Version string }) {
	t.Helper()
	_, source, _, _ := runtime.Caller(0)
	repository := filepath.Join(filepath.Dir(source), "..", "..", "..")
	cmd := exec.Command("go", "list", "-mod=readonly", "-m", "-json", path)
	cmd.Dir = repository
	cmd.Env = append(os.Environ(), "GOWORK=off", "GOFLAGS=", "GOMODCACHE="+ambientModCache)
	output, err := cmd.Output()
	if err != nil {
		t.Fatalf("cannot resolve %s in the controller's module graph: %v", path, err)
	}
	if err = json.Unmarshal(output, &listed); err != nil || listed.Dir == "" {
		t.Fatalf("the controller's module cache has no extracted %s: %v", path, err)
	}
	return listed
}

// PublishSDK serves the plugin SDK at version, built from the pinned SDK tree.
// mutate, when given, edits a scratch copy of the tree first, which is how tests
// make releases that lack the isolation capability.
func (w *World) PublishSDK(version string, mutate func(tree string)) Release {
	w.t.Helper()
	tree := filepath.Join(w.Root, "tree-"+strings.ReplaceAll(version, "/", "_"))
	copyTree(w.t, PinnedSDK(w.t), tree)
	if mutate != nil {
		mutate(tree)
	}
	return w.publishTree(devsdk.Module, version, tree)
}

// PublishPinned serves a module of this repository's build list at its pinned
// version, for the dependencies of a consumer that imports real SDK packages.
func (w *World) PublishPinned(path string) Release {
	w.t.Helper()
	listed := pinnedModule(w.t, path)
	return w.publishTree(path, listed.Version, listed.Dir)
}

func (w *World) publishTree(path, version, tree string) Release {
	w.t.Helper()
	directory := filepath.Join(w.Proxy, filepath.FromSlash(path), "@v")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		w.t.Fatal(err)
	}
	archive := filepath.Join(directory, version+".zip")
	file, err := os.Create(archive)
	if err != nil {
		w.t.Fatal(err)
	}
	createErr := zip.CreateFromDir(file, module.Version{Path: path, Version: version}, tree)
	if err = errors.Join(createErr, file.Close()); err != nil {
		w.t.Fatalf("cannot zip %s@%s: %v", path, version, err)
	}
	goMod, err := os.ReadFile(filepath.Join(tree, "go.mod"))
	if err != nil {
		w.t.Fatal(err)
	}
	moduleSum, err := dirhash.HashZip(archive, dirhash.Hash1)
	if err != nil {
		w.t.Fatal(err)
	}
	for name, data := range map[string][]byte{
		version + ".mod":  goMod,
		version + ".info": []byte(fmt.Sprintf("{\"Version\":%q,\"Time\":\"2026-11-08T00:00:00Z\"}\n", version)),
	} {
		if err = os.WriteFile(filepath.Join(directory, name), data, 0o600); err != nil {
			w.t.Fatal(err)
		}
	}
	versions, _ := os.ReadFile(filepath.Join(directory, "list"))
	if err = os.WriteFile(filepath.Join(directory, "list"), append(versions, []byte(version+"\n")...), 0o600); err != nil {
		w.t.Fatal(err)
	}
	return Release{Module: path, Version: version, ModuleSum: moduleSum, GoModSum: goModSum(w.t, goMod)}
}

func goModSum(t testing.TB, goMod []byte) string {
	t.Helper()
	sum, err := dirhash.Hash1([]string{"go.mod"}, func(string) (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(goMod)), nil })
	if err != nil {
		t.Fatal(err)
	}
	return sum
}

// Consumer writes a tiny consumer module that imports a dependency-light real
// SDK package, requiring the given releases, with a go.sum that records exactly
// their checksums. It returns the module root.
func (w *World) Consumer(name string, releases ...Release) string {
	w.t.Helper()
	directory := filepath.Join(w.Root, name)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		w.t.Fatal(err)
	}
	var goMod, goSum strings.Builder
	goMod.WriteString("module example.com/" + name + "\n\ngo 1.26.0\n\nrequire (\n")
	for _, release := range releases {
		fmt.Fprintf(&goMod, "\t%s %s\n", release.Module, release.Version)
		fmt.Fprintf(&goSum, "%s %s %s\n%s %s/go.mod %s\n", release.Module, release.Version, release.ModuleSum, release.Module, release.Version, release.GoModSum)
	}
	goMod.WriteString(")\n")
	w.Write(directory, "go.mod", goMod.String())
	w.Write(directory, "go.sum", goSum.String())
	w.Write(directory, "main.go", "package main\n\nimport (\n\t\"fmt\"\n\n\t\"github.com/omniviewdev/plugin-sdk/pkg/profilecontract\"\n)\n\nfunc main() { fmt.Println(profilecontract.CanonicalPath(\"/\")) }\n")
	return directory
}

// Policy is the production release policy extended with the world's served
// releases as reviewed rows: the compiled-in floor and the production rules, with
// the synthetic releases a test publishes known to it. The floor release a world
// serves is the real pinned release, so it needs no row; every other served
// version does.
func (w *World) Policy(releases ...Release) devsdk.Policy {
	reviewed := devsdk.ReviewedReleases()
	for _, release := range releases {
		reviewed = append(reviewed, release.Published())
	}
	return devsdk.NewReleasePolicy(devsdk.FloorVersion, reviewed...)
}

// Write writes one file below directory.
func (w *World) Write(directory, name, content string) {
	w.t.Helper()
	path := filepath.Join(directory, filepath.FromSlash(name))
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		w.t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		w.t.Fatal(err)
	}
}

// Extracted returns where the world's module cache extracts a module version.
func (w *World) Extracted(release Release) string {
	return filepath.Join(w.ModCache, filepath.FromSlash(release.Module)+"@"+release.Version)
}

// Download extracts the release into the world's module cache the way a real
// download would, so tests can tamper with the extracted bytes.
func (w *World) Download(consumer string, release Release) {
	w.t.Helper()
	cmd := exec.Command("go", "mod", "download", "-modfile="+filepath.Join(w.Root, "download.mod"), release.Module+"@"+release.Version)
	data, err := os.ReadFile(filepath.Join(consumer, "go.mod"))
	if err != nil {
		w.t.Fatal(err)
	}
	sum, _ := os.ReadFile(filepath.Join(consumer, "go.sum"))
	if err = errors.Join(os.WriteFile(filepath.Join(w.Root, "download.mod"), data, 0o600), os.WriteFile(filepath.Join(w.Root, "download.sum"), sum, 0o600)); err != nil {
		w.t.Fatal(err)
	}
	cmd.Dir = consumer
	cmd.Env = append(os.Environ(), w.Environment()...)
	if output, runErr := cmd.CombinedOutput(); runErr != nil {
		w.t.Fatalf("cannot download %s@%s into the scratch cache: %v\n%s", release.Module, release.Version, runErr, output)
	}
}

func copyTree(t testing.TB, from, to string) {
	t.Helper()
	err := filepath.WalkDir(from, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(from, path)
		if err != nil {
			return err
		}
		target := filepath.Join(to, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o700)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o600)
	})
	if err != nil {
		t.Fatalf("cannot copy %s: %v", from, err)
	}
}
