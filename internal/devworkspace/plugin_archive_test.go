package devworkspace

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	sdkconfig "github.com/omniviewdev/plugin-sdk/pkg/config"
	sdktypes "github.com/omniviewdev/plugin-sdk/pkg/types"
)

func TestArchiveRuntimeLaunchValidation(t *testing.T) {
	archive := LaunchOptions{Mode: "browser", PluginRuntime: PluginRuntimeArchive}
	if err := archive.Validate(); err != nil {
		t.Fatalf("static browser archive runtime refused: %v", err)
	}
	for name, options := range map[string]LaunchOptions{
		"watch":         {Mode: "browser", Watch: true, PluginRuntime: PluginRuntimeArchive},
		"live frontend": {Mode: "browser", LiveFrontend: true, PluginRuntime: PluginRuntimeArchive},
		"native":        {Mode: "native", PluginRuntime: PluginRuntimeArchive},
	} {
		var failure *devcontract.Error
		if err := options.Validate(); !errors.As(err, &failure) || failure.Code != "archive_runtime_options" || failure.Exit != 2 {
			t.Fatalf("%s: incompatible combination was not refused with a usage error: %v", name, err)
		}
		if report := PreflightLaunch(context.Background(), Workspace{}, options); !containsIssue(report, "archive_runtime_options") {
			t.Fatalf("%s: preflight did not report the incompatible combination: %+v", name, report.Issues)
		}
	}
	var failure *devcontract.Error
	if err := (LaunchOptions{Mode: "browser", PluginRuntime: "linked"}).Validate(); !errors.As(err, &failure) || failure.Code != "invalid_plugin_runtime" {
		t.Fatalf("unknown plugin runtime accepted: %v", err)
	}
	// Managed stays valid with every previously valid launch shape, spelled either way.
	for _, runtime := range []string{"", PluginRuntimeManaged} {
		if err := (LaunchOptions{Mode: "browser", Watch: true, LiveFrontend: true, PluginRuntime: runtime}).Validate(); err != nil {
			t.Fatalf("managed runtime %q refused: %v", runtime, err)
		}
	}
}

func containsIssue(report LaunchPreflight, code string) bool {
	for _, issue := range report.Issues {
		if issue.Code == code {
			return true
		}
	}
	return false
}

// Changing the runtime must invalidate a recorded host build: the reuse
// fingerprint of the host backend node differs between managed and archive.
func TestArchiveRuntimeChangesHostReuseFingerprint(t *testing.T) {
	f := newReuseFixture(t)
	g := f.g
	node := outputGraphNode(t, g, "host-backend")
	node.Dependencies = nil
	g.toolInputs = g.toolchainInputs // the fixture's constant stub would hide the variant
	fingerprint := func(options LaunchOptions) string {
		s := &workspaceSupervisor{workspace: g.workspace, options: options}
		g.options.HostVariant = s.hostVariant()
		inputs, err := g.nodeInputs(context.Background(), node)
		if err != nil {
			t.Fatal(err)
		}
		return inputs
	}
	managed := fingerprint(LaunchOptions{Mode: "browser"})
	if managed != fingerprint(LaunchOptions{Mode: "browser", PluginRuntime: PluginRuntimeManaged}) {
		t.Fatal("empty and explicit managed runtime produce different build fingerprints")
	}
	if managed == fingerprint(LaunchOptions{Mode: "browser", PluginRuntime: PluginRuntimeArchive}) {
		t.Fatal("archive runtime reuses a managed build fingerprint")
	}
}

func TestArchiveReadinessIsCapabilityAware(t *testing.T) {
	backend := sdkconfig.PluginMeta{ID: "p", Capabilities: []string{"resource", "ui"}}
	frontend := sdkconfig.PluginMeta{ID: "f", Capabilities: []string{"ui"}}
	for name, tc := range map[string]struct {
		info  sdktypes.PluginInfo
		ready bool
		code  string
	}{
		"backend running with negotiated capability":  {info: sdktypes.PluginInfo{ID: "p", Metadata: backend, Enabled: true, Phase: "Running", Capabilities: []sdktypes.Capability{"resource"}}, ready: true},
		"backend running without negotiated provider": {info: sdktypes.PluginInfo{ID: "p", Metadata: backend, Enabled: true, Phase: "Running"}},
		"backend still starting":                      {info: sdktypes.PluginInfo{ID: "p", Metadata: backend, Enabled: true, Phase: "Starting"}},
		"frontend only installed":                     {info: sdktypes.PluginInfo{ID: "f", Metadata: frontend, Enabled: true, Phase: "Installed"}, ready: true},
		"failed":                                      {info: sdktypes.PluginInfo{ID: "p", Metadata: backend, Enabled: true, Phase: "Failed"}, code: "plugin_not_ready"},
		"dev linked source is not an archive":         {info: sdktypes.PluginInfo{ID: "p", Metadata: backend, Enabled: true, DevMode: true, Phase: "Running", Capabilities: []sdktypes.Capability{"resource"}}, code: "archive_runtime_conflict"},
	} {
		ready, err := archivePluginReady(tc.info)
		var failure *devcontract.Error
		switch {
		case tc.code != "" && (!errors.As(err, &failure) || failure.Code != tc.code):
			t.Fatalf("%s: want %s, got %v", name, tc.code, err)
		case tc.code == "" && err != nil:
			t.Fatalf("%s: %v", name, err)
		case ready != tc.ready:
			t.Fatalf("%s: ready=%v", name, ready)
		}
	}
}

func readArchiveFiles(t *testing.T, path string) map[string][]byte {
	t.Helper()
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	gz, err := gzip.NewReader(file)
	if err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{}
	reader := tar.NewReader(gz)
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			return files
		}
		if err != nil {
			t.Fatal(err)
		}
		if header.Typeflag != tar.TypeReg {
			t.Fatalf("archive entry %s is not a regular file", header.Name)
		}
		raw, err := io.ReadAll(reader)
		if err != nil {
			t.Fatal(err)
		}
		files[header.Name] = raw
		if header.Name == "bin/plugin" && header.Mode&0o111 == 0 {
			t.Fatal("backend entry is not executable")
		}
	}
}

func TestPluginArchiveLayoutDigestAndRefusals(t *testing.T) {
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(dir, "plugin")
	if err := os.WriteFile(binary, []byte("backend bytes"), 0o700); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte("backend bytes"))
	expected := hex.EncodeToString(sum[:])
	assets := filepath.Join(dir, "assets")
	if err := os.MkdirAll(filepath.Join(assets, "nested"), 0o700); err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{"entry.js": "export {}", "nested/chunk.js": "chunk"} {
		if err := os.WriteFile(filepath.Join(assets, name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	entries, err := archiveAssetEntries(assets)
	if err != nil || len(entries) != 2 {
		t.Fatalf("assets were not listed: %v %v", entries, err)
	}
	entries = append(entries, archiveEntry{name: "bin/plugin", path: binary, mode: 0o755})
	path := filepath.Join(dir, "out.tar.gz")
	digest, err := writePluginArchive(path, []byte("id: p\n"), entries, expected)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := sha256.Sum256(raw); hex.EncodeToString(got[:]) != digest {
		t.Fatal("reported archive digest differs from the written bytes")
	}
	files := readArchiveFiles(t, path)
	for name, want := range map[string]string{"plugin.yaml": "id: p\n", "bin/plugin": "backend bytes", "assets/entry.js": "export {}", "assets/nested/chunk.js": "chunk"} {
		if string(files[name]) != want {
			t.Fatalf("%s missing or changed: %q", name, files[name])
		}
	}
	// A backend whose bytes differ from the recorded build evidence is never packaged.
	// Bytes swapped after the recorded digest was taken are never packaged.
	if err = os.WriteFile(binary, []byte("swapped bytes"), 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err = writePluginArchive(filepath.Join(dir, "bad.tar.gz"), []byte("id: p\n"), entries, expected); err == nil {
		t.Fatal("backend bytes that differ from the recorded digest were packaged")
	}
	if err = os.WriteFile(binary, []byte("backend bytes"), 0o700); err != nil {
		t.Fatal(err)
	}
	// Symlinked assets are refused, not followed.
	if err = os.Symlink(binary, filepath.Join(assets, "link.js")); err != nil {
		t.Fatal(err)
	}
	if _, err = archiveAssetEntries(assets); err == nil {
		t.Fatal("symlinked asset accepted")
	}
	if _, err = writePluginArchive(filepath.Join(dir, "link.tar.gz"), []byte("id: p\n"), []archiveEntry{{name: "assets/link.js", path: filepath.Join(assets, "link.js"), mode: 0o644}}, ""); err == nil {
		t.Fatal("symlinked input packaged")
	}
	if _, err = writePluginArchive(path, []byte("id: p\n"), nil, ""); err == nil {
		t.Fatal("existing archive was overwritten")
	}
}

func TestPublishedGeneratedFileDigestBindsBytesAfterPublication(t *testing.T) {
	w := generatedFixture(t)
	prepared, err := PrepareGeneratedTree(w, "build/p", "generation")
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(prepared.Directory, "plugin"), []byte("built bytes"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err = RecordGeneratedTree(prepared); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte("built bytes"))
	digest, err := publishedGeneratedFileDigest(w, "build/p/plugin")
	if err != nil || digest != hex.EncodeToString(sum[:]) {
		t.Fatalf("recorded publication digest: %q %v", digest, err)
	}
	if _, err = publishedGeneratedFileDigest(w, "build/p/missing"); err == nil {
		t.Fatal("unrecorded file accepted")
	}
	if err = os.WriteFile(filepath.Join(w.Root, ".local/build/p/plugin"), []byte("swapped after build"), 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err = publishedGeneratedFileDigest(w, "build/p/plugin"); err == nil {
		t.Fatal("bytes mutated after the build record were accepted")
	}
}

func TestArchiveAssetsRefuseRedirectedParentDirectory(t *testing.T) {
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	assets, outside := filepath.Join(dir, "assets"), filepath.Join(dir, "outside")
	for _, d := range []string{assets, outside} {
		if err = os.MkdirAll(d, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err = os.WriteFile(filepath.Join(outside, "secret.js"), []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(outside, filepath.Join(assets, "nested")); err != nil {
		t.Fatal(err)
	}
	if _, err = archiveAssetEntries(assets); err == nil {
		t.Fatal("asset reached through a redirected parent directory was listed")
	}
	if err = os.RemoveAll(assets); err != nil {
		t.Fatal(err)
	}
	if err = os.Symlink(outside, assets); err != nil {
		t.Fatal(err)
	}
	if _, err = archiveAssetEntries(assets); err == nil {
		t.Fatal("redirected asset root was listed")
	}
}

// Frontend-only plugin through the real ledger path: build via the graph, then
// publish; mutating or redirecting assets after the build record must fail.
func TestPublishPluginArchiveFrontendOnlyThroughOwnedOutputs(t *testing.T) {
	f := newReuseFixture(t)
	g := f.g
	source := filepath.Join(g.workspace.Root, "plugin")
	writeGraphFixture(t, filepath.Join(source, "plugin.yaml"), "id: plugin\nversion: 0.1.0\nname: Plugin\nschema_version: 1\nsdk_protocol_version: 1\ncapabilities:\n  - ui\n")
	fixtureGit(t, source, "add", "plugin.yaml")
	fixtureGit(t, source, "commit", "-m", "metadata")
	inner := g.runProducer
	g.runProducer = func(ctx context.Context, directory string, environment []string, program string, args ...string) ([]byte, error) {
		out, err := inner(ctx, directory, environment, program, args...)
		if directory == filepath.Join(source, "ui") {
			for _, entry := range environment {
				if key, value, _ := strings.Cut(entry, "="); key == "OMNIVIEW_BUILD_OUTPUT_DIRECTORY" {
					writeGraphFixture(t, filepath.Join(value, "assets", "entry.js"), "export {}\n")
					writeGraphFixture(t, filepath.Join(value, "assets", "chunk", "a.js"), "a\n")
				}
			}
		}
		return out, err
	}
	f.bootstrap(t)
	plugin := g.workspace.Manifest.Plugins[0]
	path, receipt, err := g.PublishPluginArchive(context.Background(), plugin)
	if err != nil {
		t.Fatal(err)
	}
	files := readArchiveFiles(t, path)
	if receipt.AssetFiles != 2 || string(files["assets/entry.js"]) != "export {}\n" || files["bin/plugin"] != nil || !strings.Contains(string(files["plugin.yaml"]), "id: plugin") {
		t.Fatalf("frontend-only archive layout wrong: %+v %v", receipt, files)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if sum := sha256.Sum256(raw); hex.EncodeToString(sum[:]) != receipt.ArchiveSHA256 {
		t.Fatal("receipt digest differs from published archive")
	}
	assets := filepath.Join(source, "ui", "dist", "assets")
	if err = os.WriteFile(filepath.Join(assets, "entry.js"), []byte("tampered\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err = g.PublishPluginArchive(context.Background(), plugin); err == nil {
		t.Fatal("asset mutated after the recorded publication was packaged")
	}
}
