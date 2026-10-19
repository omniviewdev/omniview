//go:build windows

package devcontract

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestCustomProfileWindowsBindingPublicationAndRebinding(t *testing.T) {
	w, home, first := customFixture(t)
	selected, err := SetCustomProfile(context.Background(), w, first, home)
	if err != nil {
		t.Fatalf("publish initial binding: %v", err)
	}
	second := filepath.Join(filepath.Dir(w.Root), "second-custom", "state")
	selected, err = SetCustomProfile(context.Background(), selected, second, home)
	if err != nil {
		t.Fatalf("replace binding and claim registry: %v", err)
	}
	if selected.StateRoot != second {
		t.Fatalf("selected state = %q, want %q", selected.StateRoot, second)
	}
	bound, present, err := ReadCustomProfileBinding(w.Root, w.Manifest.WorkspaceID, home)
	if err != nil || !present || bound != second {
		t.Fatalf("read replacement binding: %q %v %v", bound, present, err)
	}
	for _, state := range []string{first, second} {
		if err := ValidateCustomProfileClaim(state, w.Manifest.WorkspaceID, home); err != nil {
			t.Fatalf("durable claim lost for %q: %v", state, err)
		}
		if _, err := os.Lstat(state); !os.IsNotExist(err) {
			t.Fatalf("binding created state %q: %v", state, err)
		}
	}
}
