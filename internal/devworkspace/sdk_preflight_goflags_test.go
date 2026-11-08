package devworkspace

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsdk"
)

// goEnvironmentFile points the Go environment file at a file with content.
func goEnvironmentFile(t *testing.T, content string) string {
	t.Helper()
	file := filepath.Join(t.TempDir(), "env")
	require.NoError(t, os.WriteFile(file, []byte(content), 0o600))
	t.Setenv("GOENV", file)
	return file
}

func browserOptions() LaunchOptions {
	return LaunchOptions{Mode: "browser", LinkEvidence: launchEvidence()}
}

// Preflight reads the file with no Go on PATH: it runs nothing.
func TestPreflightReportsAGoEnvironmentFileGoFlags(t *testing.T) {
	for name, flags := range map[string]string{
		"overlay":  "-overlay=/tmp/overlay.json",
		"toolexec": "-toolexec=/tmp/wrapper",
		"modfile":  "-modfile=/tmp/other.mod",
		"vendor":   "-mod=vendor",
	} {
		t.Run(name, func(t *testing.T) {
			w := publishedWorkspace(t)
			goEnvironmentFile(t, "GOFLAGS="+flags+"\n")
			t.Setenv("PATH", t.TempDir())
			before := treeDigest(t, w.Root)

			report := PreflightLaunch(context.Background(), w, browserOptions(), devsdk.ReleasePolicy())
			require.False(t, report.Ready)
			require.Equal(t, []string{devsdk.CodeSelectionConflict}, issueCodes(report))
			require.Equal(t, 4, report.Issues[0].Exit)
			require.Contains(t, report.Issues[0].Message, flags)
			require.Equal(t, flags, report.Issues[0].Details["goflags"])
			require.Equal(t, before, treeDigest(t, w.Root))
			require.NotNil(t, report.SDK, "the sdk object is unchanged")
			require.Len(t, report.SDK.Consumers, 2)
		})
	}
}

func TestPreflightGoEnvironmentFileParsing(t *testing.T) {
	for name, test := range map[string]struct {
		content string
		refused string
	}{
		"last GOFLAGS wins":      {"GOFLAGS=-mod=vendor\nGOFLAGS=-toolexec=/x\n", "-toolexec=/x"},
		"a later empty GOFLAGS":  {"GOFLAGS=-mod=vendor\nGOFLAGS=\n", ""},
		"empty GOFLAGS":          {"GOFLAGS=\n", ""},
		"blank and comments":     {"\n# GOFLAGS=-mod=vendor\n\n  \nGOPROXY=direct\n", ""},
		"first equals splits":    {"GOFLAGS=-ldflags=-X=a=b\n", "-ldflags=-X=a=b"},
		"carriage return":        {"GOPROXY=direct\r\nGOFLAGS=-mod=vendor\r\n", "-mod=vendor"},
		"other keys only":        {"GOPROXY=direct\nGOFLAGSX=-mod=vendor\n", ""},
		"blank value is no flag": {"GOFLAGS=   \n", ""},
	} {
		t.Run(name, func(t *testing.T) {
			w := publishedWorkspace(t)
			goEnvironmentFile(t, test.content)
			report := PreflightLaunch(context.Background(), w, browserOptions(), devsdk.ReleasePolicy())
			if test.refused == "" {
				require.True(t, report.Ready, "%v", issueCodes(report))
				return
			}
			require.Equal(t, []string{devsdk.CodeSelectionConflict}, issueCodes(report))
			require.Equal(t, test.refused, report.Issues[0].Details["goflags"])
		})
	}
}

func TestPreflightIgnoresAnAmbientGoFlagsVariable(t *testing.T) {
	w := publishedWorkspace(t)
	t.Setenv("GOFLAGS", "-toolexec=/tmp/wrapper")
	report := PreflightLaunch(context.Background(), w, browserOptions(), devsdk.ReleasePolicy())
	require.True(t, report.Ready, "%v", issueCodes(report))
}

func TestPreflightGoEnvOffIgnoresTheDefaultFile(t *testing.T) {
	w := publishedWorkspace(t)
	config := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(config, "go"), 0o700))
	require.NoError(t, os.WriteFile(filepath.Join(config, "go", "env"), []byte("GOFLAGS=-mod=vendor\n"), 0o600))
	t.Setenv("XDG_CONFIG_HOME", config)
	t.Setenv("HOME", config)
	t.Setenv("GOENV", "off")
	report := PreflightLaunch(context.Background(), w, browserOptions(), devsdk.ReleasePolicy())
	require.True(t, report.Ready, "%v", issueCodes(report))
}

func TestPreflightReadsTheDefaultLocationFile(t *testing.T) {
	w := publishedWorkspace(t)
	home := t.TempDir()
	config := filepath.Join(home, "config")
	for _, directory := range []string{filepath.Join(config, "go"), filepath.Join(home, "Library", "Application Support", "go")} {
		require.NoError(t, os.MkdirAll(directory, 0o700))
		require.NoError(t, os.WriteFile(filepath.Join(directory, "env"), []byte("GOFLAGS=-overlay=/x.json\n"), 0o600))
	}
	t.Setenv("GOENV", "")
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", config)
	report := PreflightLaunch(context.Background(), w, browserOptions(), devsdk.ReleasePolicy())
	require.Equal(t, []string{devsdk.CodeSelectionConflict}, issueCodes(report))
}

func TestPreflightWithAMissingGoEnvironmentFileReportsNothing(t *testing.T) {
	w := publishedWorkspace(t)
	t.Setenv("GOENV", filepath.Join(t.TempDir(), "absent"))
	require.NotPanics(t, func() {
		report := PreflightLaunch(context.Background(), w, browserOptions(), devsdk.ReleasePolicy())
		require.True(t, report.Ready, "%v", issueCodes(report))
	})
}

func TestPreflightOfASourceWorkspaceReadsNoGoEnvironment(t *testing.T) {
	w := publishedWorkspace(t)
	sdk := "plugin-sdk"
	w.Manifest.Repositories = append(w.Manifest.Repositories, devcontract.Repository{ID: sdk, Directory: "sdk"})
	w.Manifest.Links.SDKRepositoryID = &sdk
	goEnvironmentFile(t, "GOFLAGS=-overlay=/tmp/overlay.json\n")

	report := PreflightLaunch(context.Background(), w, browserOptions(), devsdk.Policy{})
	require.True(t, report.Ready, "%v", issueCodes(report))
}

// The Go-environment issue is reported alongside the others, after the
// declaration issues and before the mode issues.
func TestPreflightGoEnvironmentIssueOrderIsStable(t *testing.T) {
	w := publishedWorkspace(t)
	writeConsumerModule(t, filepath.Join(w.Root, "omniview"), "v0.16.0")
	goEnvironmentFile(t, "GOFLAGS=-overlay=/tmp/overlay.json\n")
	report := PreflightLaunch(context.Background(), w, LaunchOptions{Mode: "native"}, devsdk.ReleasePolicy())
	require.Equal(t, []string{
		"link_evidence_required",
		devsdk.CodeReleaseUntrusted,
		devsdk.CodeSelectionConflict,
		"sdk_published_native_unsupported",
	}, issueCodes(report))
}

func TestCreateLaunchPreflightReadsTheGoEnvironmentFileAndPublishesNothingWhenRefused(t *testing.T) {
	m, root, options := publishedCreateFixture(t)
	goEnvironmentFile(t, "GOFLAGS=-toolexec=/tmp/wrapper\n")

	err := m.PreflightCreateLaunch(context.Background(), CreateOptions{Slug: "refused-goflags", Plugins: []string{"kubernetes"}}, options)
	var issue *devcontract.Error
	require.ErrorAs(t, err, &issue)
	require.Equal(t, devsdk.CodeSelectionConflict, issue.Code)
	require.Equal(t, 4, issue.Exit)
	require.NoDirExists(t, filepath.Join(root, "workspaces", "refused-goflags"))
}
