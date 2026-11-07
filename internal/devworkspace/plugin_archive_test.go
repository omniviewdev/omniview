package devworkspace

import (
	"archive/tar"
	"compress/gzip"
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
		if report := PreflightLaunch(Workspace{}, options); !containsIssue(report, "archive_runtime_options") {
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

func TestArchiveRuntimeIsPartOfVariantAndLifecycleComparison(t *testing.T) {
	managed := &workspaceSupervisor{options: LaunchOptions{Mode: "browser"}}
	explicit := &workspaceSupervisor{options: LaunchOptions{Mode: "browser", PluginRuntime: PluginRuntimeManaged}}
	archive := &workspaceSupervisor{options: LaunchOptions{Mode: "browser", PluginRuntime: PluginRuntimeArchive}}
	if managed.hostVariant() != explicit.hostVariant() {
		t.Fatal("empty and explicit managed runtime produce different build variants")
	}
	if managed.hostVariant() == archive.hostVariant() {
		t.Fatal("archive runtime does not change the reuse variant")
	}
	fields := launchOptionDifferences(archive.options, explicit.options)
	if len(fields) != 1 || fields[0] != "launch.pluginRuntime" {
		t.Fatalf("lifecycle intent comparison omitted the plugin runtime: %v", fields)
	}
}

func TestArchiveRuntimeRefusesInPlaceSourceUpdate(t *testing.T) {
	s := &workspaceSupervisor{options: LaunchOptions{Mode: "browser", PluginRuntime: PluginRuntimeArchive}}
	_, err := s.applySourceUpdate(t.Context())
	var failure *devcontract.Error
	if !errors.As(err, &failure) || failure.Code != "archive_runtime_source_update" {
		t.Fatalf("archive runtime accepted an in-place source update: %v", err)
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
	dir := t.TempDir()
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
	if _, err = writePluginArchive(filepath.Join(dir, "bad.tar.gz"), []byte("id: p\n"), entries, strings.Repeat("0", 64)); err == nil {
		t.Fatal("backend bytes that differ from build evidence were packaged")
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
