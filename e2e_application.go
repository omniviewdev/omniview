//go:build e2eapplication

package main

// This adapter is compiled only by the application test invocation. It prepares
// actual profile metadata and trusted artifact admission, then exits. Ordinary
// launches fall through to unchanged main and its real services/loaders.
import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/internal/devsource"
	"github.com/omniviewdev/omniview/internal/devworkspace"
	"github.com/omniviewdev/omniview/internal/instance"
)

func init() {
	if len(os.Args) < 2 {
		return
	}
	var result any
	var err error
	switch os.Args[1] {
	case "--e2e-create-profile":
		if len(os.Args) != 5 {
			fmt.Fprintln(os.Stderr, "invalid profile arguments")
			os.Exit(2)
		}
		var profile instance.Profile
		profile, err = createApplicationProfile(os.Args[2], os.Args[3], os.Args[4])
		if err == nil {
			result = map[string]any{"descriptor": profile.Descriptor, "runtimeRoot": profile.RuntimeRoot, "manifest": profile.Workspace.ManifestPath}
		}
	case "--e2e-record-plugin":
		if len(os.Args) != 8 {
			fmt.Fprintln(os.Stderr, "invalid plugin artifact arguments")
			os.Exit(2)
		}
		err = recordApplicationPlugin(os.Args[2], os.Args[3], os.Args[4], os.Args[5], os.Args[6], os.Args[7])
		result = map[string]bool{"recorded": err == nil}
	case "--e2e-own-command":
		if len(os.Args) != 3 {
			fmt.Fprintln(os.Stderr, "invalid owned command arguments")
			os.Exit(2)
		}
		var options devworkspace.ApplicationFixtureCommand
		err = devsession.ReadPrivateJSON(os.Args[2], &options)
		if err == nil {
			options.Environment = os.Environ()
			shutdown := make(chan os.Signal, 2)
			signal.Notify(shutdown, os.Interrupt, syscall.SIGTERM)
			defer signal.Stop(shutdown)
			err = devworkspace.RunApplicationFixtureCommand(options, shutdown)
		}
		result = map[string]bool{"drained": err == nil}
	default:
		return
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		os.Exit(1)
	}
	os.Exit(0)
}

func createApplicationProfile(root, name, commit string) (instance.Profile, error) {
	var empty instance.Profile
	if !filepath.IsAbs(root) || (name != "profile-a" && name != "profile-b") {
		return empty, fmt.Errorf("invalid application profile selection")
	}
	manifest := devcontract.WorkspaceManifest{SchemaVersion: devcontract.SchemaVersion, WorkspaceID: uuid.NewString(), Slug: name, DisplayName: name, Repositories: []devcontract.Repository{{ID: "omniview", Directory: "artifact", BaseRef: commit, BaseCommit: commit, Branch: "application-fixture"}}, Plugins: []devcontract.Plugin{}, Profile: devcontract.Profile{Kind: "development"}, Ports: devcontract.PortPolicy{Policy: "sticky"}}
	if err := manifest.Validate(); err != nil {
		return empty, err
	}
	if err := os.Mkdir(root, 0700); err != nil {
		return empty, err
	}
	// The repository location identifies the immutable application artifact, not
	// a fabricated source checkout or a per-profile compiler composition.
	if err := os.Mkdir(filepath.Join(root, "artifact"), 0700); err != nil {
		return empty, err
	}
	if err := devsession.WritePrivateJSON(filepath.Join(root, "workspace.json"), manifest); err != nil {
		return empty, err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return empty, err
	}
	if err := devcontract.EnsureDefaultProfileOwnership(home, manifest.WorkspaceID); err != nil {
		return empty, err
	}
	return instance.Resolve(instance.Options{Workspace: root, Home: home, Channel: "local"})
}

func recordApplicationPlugin(root, id, binary, sdk, revision, digest string) error {
	if digest == "" {
		return fmt.Errorf("verified SDK source evidence is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	identity, err := devsource.Verify(ctx, sdk, revision)
	if err != nil {
		return err
	}
	if identity.SourceDigest != digest {
		return fmt.Errorf("SDK source changed after the actual artifact build")
	}
	profile, err := instance.Resolve(instance.Options{Workspace: root, Channel: "local"})
	if err != nil {
		return err
	}
	return instance.RecordBuiltArtifactSource(*profile.Workspace, id, binary, revision, digest)
}
