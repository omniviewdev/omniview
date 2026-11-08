package devworkspace

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devoutputs"
	"github.com/omniviewdev/omniview/internal/devsdk"
)

const pubBindingsFile = "packages/omniviewdev-runtime/src/bindings/index.ts"

// pubFakeTask is the Taskfile's `task bindings` producer: it records the process
// environment and its arguments into a file and writes the producer files into
// BINDINGS_OUTPUT_DIRECTORY, like the real producer's output directory contract.
const pubFakeTask = `#!/bin/sh
{
	printf 'TASK'
	for argument in "$@"; do printf ' %%s' "$argument"; done
	printf '\n'
} >> %[1]s
env > %[2]s
directory=
for argument in "$@"; do
	case "$argument" in BINDINGS_OUTPUT_DIRECTORY=*) directory="${argument#BINDINGS_OUTPUT_DIRECTORY=}" ;; esac
done
if [ -z "$directory" ]; then echo "no bindings output directory" >&2; exit 2; fi
mkdir -p "$directory"
printf 'export const generated = "published";\n' > "$directory/index.ts"
`

// pubBindingsFixture is a real published workspace made by the manager (real Git
// worktrees of repositories that carry real Go modules), stopped and linked.
type pubBindingsFixture struct {
	env     *pubEnv
	manager *Manager
	w       Workspace
	log     string // go shim and fake task invocations, in order
	taskEnv string
}

func (e *pubEnv) bindingsFixture() *pubBindingsFixture {
	t := e.t
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	root = filepath.Join(root, "sources")
	require.NoError(t, os.MkdirAll(root, 0o700))

	host := fixtureRepo(t, root, "omniview", "")
	pubWrite(t, filepath.Join(host, "go.mod"), pubGoMod("github.com/omniviewdev/omniview", "", e.sdk, e.uuid))
	pubWrite(t, filepath.Join(host, "go.sum"), pubSums(e.sdk, e.uuid))
	pubWrite(t, filepath.Join(host, "main.go"), pubProfileMain)
	pubWrite(t, filepath.Join(host, "package.json"), `{"name":"omniview","version":"1.0.0","private":true,"packageManager":"pnpm@12.14.0"}`+"\n")
	pubWrite(t, filepath.Join(host, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n")
	pubWrite(t, filepath.Join(host, filepath.FromSlash(pubBindingsFile)), "export const original = true;\n")
	for directory, name := range map[string]string{"omniviewdev-providers": "@omniviewdev/providers", "omniviewdev-runtime": "@omniviewdev/runtime", "omniviewdev-vite-plugin": "@omniviewdev/vite-plugin"} {
		pubWrite(t, filepath.Join(host, "packages", directory, "package.json"),
			`{"name":"`+name+`","version":"1.0.0","private":true,"packageManager":"pnpm@12.14.0","dependencies":{"react":"19.0.0","react-dom":"19.0.0"},"scripts":{"build":"builder","typecheck":"checker"}}`+"\n")
	}
	pubWrite(t, filepath.Join(host, ".gitignore"), "node_modules/\ndist/\n")
	fixtureGit(t, host, "add", ".")
	fixtureGit(t, host, "commit", "-m", "host module")

	plugin := fixtureRepo(t, root, "omniview-plugin-kubernetes", "kubernetes")
	pubWrite(t, filepath.Join(plugin, "go.mod"), pubGoMod("example.com/plugin", "", e.sdk, e.uuid))
	pubWrite(t, filepath.Join(plugin, "go.sum"), pubSums(e.sdk, e.uuid))
	pubWrite(t, filepath.Join(plugin, "pkg", "main.go"), pubProfileMain)
	fixtureGit(t, plugin, "add", ".")
	fixtureGit(t, plugin, "commit", "-m", "plugin module")

	_, err = Init(context.Background(), InitOptions{Root: root})
	require.NoError(t, err)
	e.activate()
	manager, err := Open(root, Options{Home: e.home, SDKPolicy: e.policy, Stopped: func(context.Context, devcontract.ResolvedWorkspace) error { return nil }})
	require.NoError(t, err)
	w, err := manager.Create(context.Background(), CreateOptions{Slug: "feature", Plugins: []string{"kubernetes"}})
	require.NoError(t, err)
	require.Nil(t, w.Manifest.Links.SDKRepositoryID, "no SDK repository is selected, so the workspace is published")
	w, err = manager.Inspect(context.Background(), "feature")
	require.NoError(t, err)
	pubLinkWorkspace(t, w)

	f := &pubBindingsFixture{env: e, manager: manager, w: w, log: pubGoShim(t)}
	f.taskEnv = filepath.Join(t.TempDir(), "task-environment")
	taskDirectory := t.TempDir()
	pubWrite(t, filepath.Join(taskDirectory, "task"), strings.NewReplacer("%[1]s", pubShellQuote(f.log), "%[2]s", pubShellQuote(f.taskEnv), "%%", "%").Replace(pubFakeTask))
	require.NoError(t, os.Chmod(filepath.Join(taskDirectory, "task"), 0o700))
	t.Setenv("PATH", taskDirectory+string(os.PathListSeparator)+os.Getenv("PATH"))
	return f
}

// pubLinkWorkspace records the completed selected dependency link the way the
// graph fixtures do: the plan's composition files applied, journaled as linked,
// and the aggregate install finished.
func pubLinkWorkspace(t *testing.T, w Workspace) {
	t.Helper()
	plan, err := makeLinkPlan(w)
	require.NoError(t, err)
	journal := linkJournal{
		SchemaVersion: 2, WorkspaceID: w.Manifest.WorkspaceID, Root: w.Root, Phase: "applying", Manifest: w.Manifest, Plan: plan,
		Evidence: LinkProtocolEvidence{Protocol: "workspace", Versions: []string{"12.14.0"}, AtomicDist: true, Peers: true, Runtime: true},
	}
	for _, file := range plan.Composition.Files {
		entry, snapshotErr := snapshotLinkFile(w.Root, file.Path)
		require.NoError(t, snapshotErr)
		entry.Applied, entry.AppliedHash = file.Data, linkHash(file.Data, true)
		journal.Files = append(journal.Files, entry)
	}
	require.NoError(t, applyLinkFiles(&journal))
	journal.Phase = "linked"
	require.NoError(t, saveLinkJournal(&journal))
	writer, err := devoutputs.BeginCompositionInstall(context.Background(), w.ResolvedWorkspace, *plan.Composition)
	require.NoError(t, err)
	require.NoError(t, writer.Finish(context.Background()))
}

func (f *pubBindingsFixture) taskRan(t *testing.T) bool {
	t.Helper()
	for _, line := range pubInvocations(t, f.log) {
		if strings.HasPrefix(line, "TASK ") {
			return true
		}
	}
	return false
}

func (f *pubBindingsFixture) hostBindings() string {
	return filepath.Join(f.w.Root, "omniview", filepath.FromSlash(pubBindingsFile))
}

// Success: the published preflight runs real Go commands before the bindings
// task is started, the task sees none of the ambient SDK_SOURCE and none of the
// ambient Go module flags, and the bindings it generates are published into the
// host.
func TestPublishedBindingsVerifyThePublishedSDKBeforeTheTaskAndPublishItsOutput(t *testing.T) {
	env := newPubEnv(t)
	f := env.bindingsFixture()
	t.Setenv("GOFLAGS", "-mod=vendor")
	t.Setenv("GOWORK", filepath.Join(f.w.Root, "ambient.work"))

	directory, err := f.manager.GenerateBindings(context.Background(), "feature", io.Discard)

	require.NoError(t, err)
	require.Equal(t, filepath.Join(f.w.Root, "omniview"), directory)
	require.Equal(t, "export const generated = \"published\";\n", pubRead(t, f.hostBindings()))

	lines := pubInvocations(t, f.log)
	firstTask, lastResolution := -1, -1
	for index, line := range lines {
		switch {
		case strings.HasPrefix(line, "TASK ") && firstTask < 0:
			firstTask = index
		case strings.HasPrefix(line, "list "):
			lastResolution = index
		}
	}
	require.GreaterOrEqual(t, firstTask, 0, "the bindings task never ran: %v", lines)
	require.GreaterOrEqual(t, lastResolution, 0, "the published SDK was never resolved by a real go command: %v", lines)
	var before []string
	for _, line := range lines[:firstTask] {
		before = append(before, strings.Fields(line)[0])
	}
	require.Contains(t, before, "list", "published preflight must resolve the SDK before the task starts")
	require.Contains(t, lines[firstTask], "TASK bindings ")
	require.Contains(t, lines[firstTask], "BINDINGS_OUTPUT_DIRECTORY=")

	environment := pubRead(t, f.taskEnv)
	require.NotContains(t, environment, "SDK_SOURCE=", "an ambient SDK_SOURCE must never reach the bindings task")
	require.NotContains(t, environment, "/ambient/sdk")
	require.Contains(t, environment, "GOWORK=off")
	require.Contains(t, environment, "GOFLAGS=\n", "ambient module flags are neutralized")
	require.NotContains(t, environment, "-mod=vendor")
}

// A published refusal in the preflight leaves the bindings task unrun and the
// host's bindings untouched.
func TestPublishedBindingsRefuseASDKReplaceBeforeTheTaskRuns(t *testing.T) {
	env := newPubEnv(t)
	f := env.bindingsFixture()
	goMod := filepath.Join(f.w.Root, "omniview", "go.mod")
	pubWrite(t, goMod, pubRead(t, goMod)+"\nreplace "+devsdk.Module+" => ../sdk\n")

	_, err := f.manager.GenerateBindings(context.Background(), "feature", io.Discard)

	pubRequireCode(t, err, devsdk.CodeSelectionConflict, 4)
	require.False(t, f.taskRan(t), "the preflight must refuse before the producer starts")
	_, statErr := os.Stat(f.taskEnv)
	require.ErrorIs(t, statErr, os.ErrNotExist, "the fake task wrote its environment record, so it ran")
	require.Equal(t, "export const original = true;\n", pubRead(t, f.hostBindings()))
}

// A plugin that imports an SDK package the release lacks is refused by the same
// preflight, naming the import, before the task.
func TestPublishedBindingsRefuseAPluginImportingAMissingSDKPackageBeforeTheTaskRuns(t *testing.T) {
	env := newPubEnv(t)
	f := env.bindingsFixture()
	pubWrite(t, filepath.Join(f.w.Root, "omniview-plugin-kubernetes", "pkg", "newer.go"), "package main\n\nimport _ \"github.com/omniviewdev/plugin-sdk/pkg/postdates\"\n")

	_, err := f.manager.GenerateBindings(context.Background(), "feature", io.Discard)

	failure := pubRequireCode(t, err, "sdk_contract_mismatch", 3)
	require.Contains(t, failure.Message, "pkg/postdates")
	require.False(t, f.taskRan(t))
}
