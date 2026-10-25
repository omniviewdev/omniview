//go:build e2eapplication

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/instance"
)

func TestApplicationProfilesResolveDistinctActualPrivateState(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	var previous instance.Profile
	for _, name := range []string{"profile-a", "profile-b"} {
		root := filepath.Join(home, name)
		profile, err := createApplicationProfile(root, name, strings.Repeat("a", 40))
		if err != nil {
			t.Fatal(err)
		}
		selected, err := instance.Resolve(instance.Options{Workspace: root, Home: home, Channel: "local"})
		if err != nil {
			t.Fatal(err)
		}
		if selected.Descriptor.WorkspaceID != profile.Descriptor.WorkspaceID {
			t.Fatal("profile was not resolved through actual authority")
		}
		if previous.Descriptor.WorkspaceID != "" && (previous.Descriptor.WorkspaceID == selected.Descriptor.WorkspaceID || previous.Descriptor.StateRoot == selected.Descriptor.StateRoot || previous.RuntimeRoot == selected.RuntimeRoot) {
			t.Fatal("profiles share mutable identity/state")
		}
		if _, err := os.Stat(selected.Descriptor.StateRoot); !os.IsNotExist(err) {
			t.Fatal("profile admission opened application state")
		}
		previous = selected
	}
}

func TestApplicationPluginRecordRejectsMissingSourceEvidence(t *testing.T) {
	if err := recordApplicationPlugin("/unused", "workspace-probe", "/unused/plugin", "/unused/sdk", strings.Repeat("a", 40), ""); err == nil {
		t.Fatal("unverified source identity was accepted")
	}
}
