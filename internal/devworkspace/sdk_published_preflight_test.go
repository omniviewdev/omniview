package devworkspace

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/internal/devsdk"
	"github.com/omniviewdev/omniview/internal/devsdk/sdktest"
)

// preflight runs the published compatibility preflight with the production
// verifier under policy and the world's real Go runner.
func (e *pubEnv) preflight(w Workspace, policy devsdk.Policy) error {
	return compatibilityPreflight(context.Background(), w, devsdk.NewVerifier(policy), e.run())
}

// pubSelect rewrites a module's go.mod/go.sum to require the releases.
func pubSelect(t *testing.T, directory, module, extra string, releases ...sdktest.Release) {
	t.Helper()
	pubWrite(t, filepath.Join(directory, "go.mod"), pubGoMod(module, extra, releases...))
	pubWrite(t, filepath.Join(directory, "go.sum"), pubSums(releases...))
}

// pubTamperedSDK is a copy of the pinned SDK with its isolation capability gone:
// a checkout that would fail verification if anything resolved the SDK to it.
func pubTamperedSDK(t *testing.T) string {
	t.Helper()
	directory := filepath.Join(sdktest.TempDir(t), "tampered-sdk")
	require.NoError(t, os.MkdirAll(directory, 0o700))
	pubCopyDirectory(t, sdktest.PinnedSDK(t), directory)
	pubWrite(t, filepath.Join(directory, "pkg", "config", "isolation.go"), "package config\n")
	return directory
}

// A published workspace is verified per Go consumer with the caller's real Go
// runner, and its Go roots are import-scanned against the verified module-cache
// directory of the release.
func TestPublishedPreflightIdentifiesTheReleaseAndScansImportsAgainstTheVerifiedBytes(t *testing.T) {
	env := newPubEnv(t)
	w := env.workspace()
	env.activate()

	require.NoError(t, env.preflight(w, env.policy))

	var listed int
	for _, command := range env.world.Commands() {
		if command[0] == "list" {
			listed++
		}
	}
	require.GreaterOrEqual(t, listed, 2, "the host and the plugin are each resolved by real go commands: %v", env.world.Commands())
	directory, err := devsdk.PublishedDirectory(context.Background(), devsdk.Consumer{Name: "plugin", Directory: filepath.Join(w.Root, "plugin")}, env.run())
	require.NoError(t, err)
	require.Equal(t, env.world.Extracted(env.sdk), directory, "the scan reads the module cache of the verified release")
}

// An import of an SDK package the verified release does not contain is named,
// from the module bytes, before anything builds. A package it does contain, in a
// consumer outside the checked source, is not an error.
func TestPublishedPreflightNamesAnImportTheReleaseLacks(t *testing.T) {
	env := newPubEnv(t)
	w := env.workspace()
	env.activate()
	plugin := filepath.Join(w.Root, "plugin")
	pubWrite(t, filepath.Join(plugin, "pkg", "newer.go"), "package main\n\nimport _ \"github.com/omniviewdev/plugin-sdk/pkg/postdates\"\n")

	err := env.preflight(w, env.policy)

	failure := pubRequireCode(t, err, "sdk_contract_mismatch", 3)
	require.Contains(t, failure.Message, "github.com/omniviewdev/plugin-sdk/pkg/postdates")
	require.Contains(t, failure.Message, "plugin")

	// Control: the same file importing a package the release has is accepted.
	pubWrite(t, filepath.Join(plugin, "pkg", "newer.go"), "package main\n\nimport _ \"github.com/omniviewdev/plugin-sdk/pkg/config\"\n")
	require.NoError(t, env.preflight(w, env.policy))
}

// Replacements, vendoring and unreviewed or damaged releases are refused with
// their own typed codes.
func TestPublishedPreflightRefusals(t *testing.T) {
	t.Run("replace in the plugin", func(t *testing.T) {
		env := newPubEnv(t)
		w := env.workspace()
		env.activate()
		goMod := filepath.Join(w.Root, "plugin", "go.mod")
		pubWrite(t, goMod, pubRead(t, goMod)+"\nreplace "+devsdk.Module+" => ../sdk\n")

		pubRequireCode(t, env.preflight(w, env.policy), devsdk.CodeSelectionConflict, 4)
		for _, command := range env.world.Commands() {
			require.NotEqual(t, "download", command[0], "a replace is refused from the module files, never resolved: %v", command)
		}
	})
	t.Run("vendor directory in the host", func(t *testing.T) {
		env := newPubEnv(t)
		w := env.workspace()
		env.activate()
		require.NoError(t, os.MkdirAll(filepath.Join(w.Root, "omniview", "vendor"), 0o700))

		pubRequireCode(t, env.preflight(w, env.policy), devsdk.CodeSelectionConflict, 4)
		require.Empty(t, env.world.Commands(), "the host's own files refuse it before any Go command runs")
	})
	t.Run("tampered module cache entry", func(t *testing.T) {
		env := newPubEnv(t)
		w := env.workspace()
		plugin := filepath.Join(w.Root, "plugin")
		env.world.Download(plugin, env.sdk)
		extracted := env.world.Extracted(env.sdk)
		require.NoError(t, os.Chmod(filepath.Join(extracted, "pkg", "profilecontract"), 0o700))
		entries, err := os.ReadDir(filepath.Join(extracted, "pkg", "profilecontract"))
		require.NoError(t, err)
		var target string
		for _, entry := range entries {
			if strings.HasSuffix(entry.Name(), ".go") && !strings.HasSuffix(entry.Name(), "_test.go") {
				target = filepath.Join(extracted, "pkg", "profilecontract", entry.Name())
				break
			}
		}
		require.NotEmpty(t, target)
		require.NoError(t, os.Chmod(target, 0o600))
		original := pubRead(t, target)
		require.NoError(t, os.WriteFile(target, []byte(original+"\n// tampered after download\n"), 0o600))
		env.activate()

		pubRequireCode(t, env.preflight(w, env.policy), devsdk.CodeIntegrityMismatch, 4)
	})
	t.Run("release without the isolation capability", func(t *testing.T) {
		env := newPubEnv(t)
		bare := env.world.PublishSDK("v0.98.2", func(tree string) {
			pubWrite(t, filepath.Join(tree, "pkg", "config", "isolation.go"), "package config\n")
		})
		w := env.workspace()
		for _, repository := range []string{"omniview", "plugin"} {
			pubSelect(t, filepath.Join(w.Root, repository), "example.com/"+repository, "", bare, env.uuid)
		}
		env.activate()

		// Reviewed by the world's table, so only the missing capability can refuse it.
		failure := pubRequireCode(t, env.preflight(w, env.world.Policy(bare)), devsdk.CodeReleaseUntrusted, 4)
		require.Contains(t, failure.Message, devsdk.Capability)
		// Not reviewed at all: refused for that reason before it is even resolved.
		pubRequireCode(t, env.preflight(w, env.world.Policy()), devsdk.CodeReleaseUntrusted, 4)
	})
}

// Negative controls with real files: settings outside the selected module files
// must not change which SDK a published workspace is verified against.
func TestPublishedPreflightIgnoresAGoWorkFileAboveTheWorkspace(t *testing.T) {
	env := newPubEnv(t)
	w := env.workspace()
	tampered := pubTamperedSDK(t)
	pubWrite(t, filepath.Join(w.Root, "go.work"),
		"go 1.27.0\n\nuse (\n\t./omniview\n\t./plugin\n\t"+tampered+"\n)\n")
	env.activate()

	// Control: Go honours the workspace when asked to, so the file is live.
	command := exec.Command("go", "list", "-m", "-f", "{{.Dir}}", devsdk.Module)
	command.Dir = filepath.Join(w.Root, "plugin")
	command.Env = append(os.Environ(), "GOWORK="+filepath.Join(w.Root, "go.work"))
	listed, err := command.Output()
	require.NoError(t, err)
	require.Equal(t, tampered, strings.TrimSpace(string(listed)), "the go.work fixture must actually redirect the SDK when honoured")

	require.NoError(t, env.preflight(w, env.policy))
	directory, err := devsdk.PublishedDirectory(context.Background(), devsdk.Consumer{Name: "plugin", Directory: filepath.Join(w.Root, "plugin")}, env.run())
	require.NoError(t, err)
	require.Equal(t, env.world.Extracted(env.sdk), directory)
}

// An exclude directive cannot steer a published consumer to another release:
// excluding the declared version makes Go drop the requirement altogether (even
// with another release served and recorded in go.sum), and verification fails
// closed with a typed refusal rather than judging whichever release remains.
func TestPublishedPreflightFailsClosedWhenAnExcludeDirectiveRemovesTheDeclaredRelease(t *testing.T) {
	t.Run("harmless exclude", func(t *testing.T) {
		env := newPubEnv(t)
		w := env.workspace()
		pubSelect(t, filepath.Join(w.Root, "plugin"), "example.com/plugin", "\nexclude "+devsdk.Module+" v0.99.0\n", env.sdk, env.uuid)
		env.activate()

		require.NoError(t, env.preflight(w, env.policy))
	})
	t.Run("excluding the declared release", func(t *testing.T) {
		env := newPubEnv(t)
		w := env.workspace()
		plugin := filepath.Join(w.Root, "plugin")
		pubSelect(t, plugin, "example.com/plugin", "\nexclude "+devsdk.Module+" "+env.sdk.Version+"\n", env.sdk, env.uuid)
		pubWrite(t, filepath.Join(plugin, "go.sum"), pubSums(env.sdk, env.other, env.uuid))
		env.activate()

		failure := pubRequireCode(t, env.preflight(w, env.policy), devsdk.CodeDependencyUnavailable, 5)
		require.Contains(t, failure.Message, "excluded")
	})
}

// The toolchain directive is the module's own business: the local toolchain's
// version is accepted, and a toolchain the pinned local environment cannot
// provide fails closed with a typed refusal instead of a silent downgrade.
func TestPublishedPreflightTreatsAToolchainDirectiveFailingClosed(t *testing.T) {
	version := func() string {
		output, err := exec.Command("go", "env", "GOVERSION").Output()
		require.NoError(t, err)
		return strings.TrimSpace(string(output))
	}()
	t.Run("local toolchain", func(t *testing.T) {
		env := newPubEnv(t)
		w := env.workspace()
		pubSelect(t, filepath.Join(w.Root, "plugin"), "example.com/plugin", "\ntoolchain "+version+"\n", env.sdk, env.uuid)
		env.activate()

		require.NoError(t, env.preflight(w, env.policy))
	})
	t.Run("unavailable toolchain with GOTOOLCHAIN=local", func(t *testing.T) {
		env := newPubEnv(t)
		w := env.workspace()
		plugin := filepath.Join(w.Root, "plugin")
		pubSelect(t, plugin, "example.com/plugin", "", env.sdk, env.uuid)
		goMod := pubRead(t, filepath.Join(plugin, "go.mod"))
		pubWrite(t, filepath.Join(plugin, "go.mod"), strings.Replace(goMod, "go 1.27.0\n", "go 1.99.0\ntoolchain go1.99.0\n", 1))
		env.activate()

		err := env.preflight(w, env.policy)
		pubRequireCode(t, err, devsdk.CodeDependencyUnavailable, 5)
	})
}

// A Go environment file's GOFLAGS (a user-level overlay here) is refused inside
// the published verification the preflight runs, before it resolves anything.
// The runner is the production graph's, which runs Go in the process
// environment, so the hostile GOENV selection is in force (the world's own runner
// pins GOENV=off).
func TestPublishedPreflightRefusesAGoEnvironmentFileGOFLAGS(t *testing.T) {
	env := newPubEnv(t)
	w := env.workspace()
	env.activate()
	env.hostileGoEnv()
	log := pubGoShim(t)
	runner := env.graph(w, nil).goRunner()

	err := compatibilityPreflight(context.Background(), w, devsdk.NewVerifier(env.policy), runner)

	failure := pubRequireCode(t, err, devsdk.CodeSelectionConflict, 4)
	require.Contains(t, failure.Message, "-overlay=")
	require.Contains(t, failure.Message, "GOFLAGS")
	require.Empty(t, pubInvocationsOf(t, log, "list"), "nothing is resolved before the refusal")
	require.Empty(t, pubInvocationsOf(t, log, "mod"), "nothing is downloaded before the refusal")
}

// Control for the refusal above: with no hostile environment file the same
// production runner and workspace verify cleanly, so the refusal is caused by the
// file and by nothing else in the fixture.
func TestPublishedPreflightAcceptsTheSameWorkspaceThroughTheGraphRunner(t *testing.T) {
	env := newPubEnv(t)
	w := env.workspace()
	env.activate()
	runner := env.graph(w, nil).goRunner()

	require.NoError(t, compatibilityPreflight(context.Background(), w, devsdk.NewVerifier(env.policy), runner))
}
