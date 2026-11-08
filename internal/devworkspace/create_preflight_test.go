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

// commitConsumerModule commits a Go module requiring the SDK at version into a
// registered source repository, so create preflight reads it as a committed blob.
func commitConsumerModule(t *testing.T, repository, version string, extra map[string]string) {
	t.Helper()
	writeConsumerModule(t, repository, version)
	for name, content := range extra {
		path := filepath.Join(repository, filepath.FromSlash(name))
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o700))
		require.NoError(t, os.WriteFile(path, []byte(content), 0o600))
	}
	fixtureGit(t, repository, "add", "-A")
	fixtureGit(t, repository, "commit", "-m", "consumer module")
}

func publishedCreateFixture(t *testing.T) (*Manager, string, LaunchOptions) {
	t.Helper()
	t.Setenv("GOENV", filepath.Join(t.TempDir(), "env"))
	m, root := fixtureManager(t)
	m.options.SDKPolicy = devsdk.ReleasePolicy()
	commitConsumerModule(t, filepath.Join(root, "omniview"), devsdk.FloorVersion, nil)
	commitConsumerModule(t, filepath.Join(root, "omniview-plugin-kubernetes"), devsdk.FloorVersion, nil)
	return m, root, LaunchOptions{Mode: "browser", LinkEvidence: launchEvidence()}
}

// A cohort that selects no SDK repository is a published-SDK cohort. Create
// preflight reads the selected committed module files before anything exists.
func TestCreateLaunchPreflightAcceptsAPublishedCohortFromCommittedModuleFiles(t *testing.T) {
	m, root, options := publishedCreateFixture(t)
	// The worktrees do not exist yet: only committed blobs can be read.
	err := m.PreflightCreateLaunch(context.Background(), CreateOptions{Slug: "published", Plugins: []string{"kubernetes"}}, options)
	require.NoError(t, err)
	require.NoDirExists(t, filepath.Join(root, "workspaces", "published"))
}

func TestCreateLaunchPreflightRefusesWhatCommittedDeclarationsAlreadyProve(t *testing.T) {
	for name, test := range map[string]struct {
		prepare func(t *testing.T, root string)
		code    string
	}{
		"SDK replace committed in the plugin": {func(t *testing.T, root string) {
			path := filepath.Join(root, "omniview-plugin-kubernetes", "go.mod")
			data, err := os.ReadFile(path)
			require.NoError(t, err)
			require.NoError(t, os.WriteFile(path, append(data, []byte("\nreplace "+devsdk.Module+" => ../sdk\n")...), 0o600))
			fixtureGit(t, filepath.Join(root, "omniview-plugin-kubernetes"), "commit", "-am", "replace the SDK")
		}, devsdk.CodeSelectionConflict},
		"vendored host": {func(t *testing.T, root string) {
			commitConsumerModule(t, filepath.Join(root, "omniview"), devsdk.FloorVersion, map[string]string{"vendor/modules.txt": "# vendored\n"})
		}, devsdk.CodeSelectionConflict},
		"release below the floor": {func(t *testing.T, root string) {
			commitConsumerModule(t, filepath.Join(root, "omniview"), "v0.16.0", nil)
		}, devsdk.CodeReleaseUntrusted},
	} {
		t.Run(name, func(t *testing.T) {
			m, root, options := publishedCreateFixture(t)
			test.prepare(t, root)
			err := m.PreflightCreateLaunch(context.Background(), CreateOptions{Slug: "refused", Plugins: []string{"kubernetes"}}, options)
			var issue *devcontract.Error
			require.ErrorAs(t, err, &issue)
			require.Equal(t, test.code, issue.Code, issue.Message)
			require.NoDirExists(t, filepath.Join(root, "workspaces", "refused"), "a refused preflight must publish nothing")
		})
	}
}

func TestCreateLaunchPreflightUsesTheManagersPolicy(t *testing.T) {
	m, root, options := publishedCreateFixture(t)
	m.options.SDKPolicy = devsdk.Policy{}
	err := m.PreflightCreateLaunch(context.Background(), CreateOptions{Slug: "zero-policy", Plugins: []string{"kubernetes"}}, options)
	var issue *devcontract.Error
	require.ErrorAs(t, err, &issue)
	require.Equal(t, devsdk.CodeReleaseUntrusted, issue.Code)
	require.NoDirExists(t, filepath.Join(root, "workspaces", "zero-policy"))
}

// Selecting the SDK repository is explicit source mode: committed module
// declarations are not judged, and the cohort is not refused for lacking
// protocol evidence only when evidence is provided.
func TestCreateLaunchPreflightOfASourceCohortIsUnchanged(t *testing.T) {
	m, root, options := publishedCreateFixture(t)
	commitConsumerModule(t, filepath.Join(root, "omniview"), "v0.16.0", nil)
	err := m.PreflightCreateLaunch(context.Background(), CreateOptions{Slug: "source", Repositories: []string{"plugin-sdk"}, Plugins: []string{"kubernetes"}}, options)
	require.NoError(t, err)
	options.LinkEvidence = LinkProtocolEvidence{}
	err = m.PreflightCreateLaunch(context.Background(), CreateOptions{Slug: "source", Repositories: []string{"plugin-sdk"}, Plugins: []string{"kubernetes"}}, options)
	var issue *devcontract.Error
	require.ErrorAs(t, err, &issue)
	require.Equal(t, "link_evidence_required", issue.Code)
}

func TestCreateLaunchPreflightRefusesNativeForAPublishedCohort(t *testing.T) {
	m, root, options := publishedCreateFixture(t)
	options.Mode = "native"
	err := m.PreflightCreateLaunch(context.Background(), CreateOptions{Slug: "native", Plugins: []string{"kubernetes"}}, options)
	var issue *devcontract.Error
	require.ErrorAs(t, err, &issue)
	require.Equal(t, "sdk_published_native_unsupported", issue.Code)
	require.NoDirExists(t, filepath.Join(root, "workspaces", "native"))
}
