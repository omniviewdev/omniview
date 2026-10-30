package main

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/omniviewdev/omniview/internal/devsession"
	"github.com/omniviewdev/omniview/internal/devworkspace"
)

func TestWorkspaceExplicitMalformedEvidenceDoesNotReuseSavedAuthorityEdges(t *testing.T) {
	for _, verb := range []string{"up", "preflight", "refresh", "update", "follow", "recover", "link"} {
		t.Run(verb, func(t *testing.T) {
			f := newCLIEdgeFixture(t)
			directory, err := devsession.EnsurePrivateDirectory(filepath.Join(f.workspace.Root, ".local"))
			if err != nil {
				t.Fatal(err)
			}
			// Distinct saved and collection inputs make accidental fallback observable.
			saved := devworkspace.LaunchOptions{LinkEvidence: devworkspace.LinkProtocolEvidence{Protocol: "saved-authority"}}
			if err := devsession.WritePrivateJSON(filepath.Join(directory, "launch.json"), saved); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(f.root, ".omniview-dev", "link-protocol.json"), []byte(`{"protocol":"collection-authority"}`), 0600); err != nil {
				t.Fatal(err)
			}
			proof := filepath.Join(t.TempDir(), "explicit.json")
			if err := os.WriteFile(proof, []byte("{broken"), 0600); err != nil {
				t.Fatal(err)
			}
			command, err := parseWorkspaceCommand([]string{"workspace", verb, "feature", "--root", f.root, "--link-evidence", proof}, io.Discard)
			if err != nil {
				t.Fatal(err)
			}
			_, err = workspaceLaunchOptions(command, f.workspace)
			var failure *devcontract.Error
			if !errors.As(err, &failure) || failure.Code != "invalid_link_evidence" {
				t.Fatalf("explicit evidence fell back to stored authority: %v", err)
			}
		})
	}
}
