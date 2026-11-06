package nativeapps

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestDiscoveryFiltersUnsupportedAndDuplicateApplications(t *testing.T) {
	apps, err := decode(`[{"bundleID":"com.apple.Terminal","name":"Device Terminal","path":"/System/Applications/Utilities/Terminal.app","iconDataURL":"data:image/png;base64,fixture"},{"bundleID":"com.apple.Terminal","name":"Duplicate","path":"/Other.app"},{"bundleID":"com.example.Editor","name":"Editor","path":"/Editor.app"},{"bundleID":"com.googlecode.iterm2","name":"Device iTerm","path":"/Applications/iTerm.app"}]`)
	if err != nil {
		t.Fatal(err)
	}
	if len(apps) != 2 || apps[0].ID != "terminal" || apps[1].ID != "iterm2" {
		t.Fatalf("unexpected applications: %#v", apps)
	}
}

func TestDiscoveryMissingApplications(t *testing.T) {
	apps, err := discover(context.Background(), "darwin", func(context.Context, string) (string, error) { return "[]", nil })
	if err != nil || apps == nil || len(apps) != 0 {
		t.Fatalf("apps=%#v error=%v", apps, err)
	}
}

func TestDiscoveryErrorsDoNotBecomeEmptySuccess(t *testing.T) {
	for _, response := range []struct {
		output string
		err    error
	}{{"", errors.New("private diagnostic")}, {"truncated JSON", nil}, {"null", nil}} {
		apps, err := discover(context.Background(), "darwin", func(context.Context, string) (string, error) { return response.output, response.err })
		if err == nil || apps != nil {
			t.Fatalf("apps=%#v error=%v", apps, err)
		}
		if strings.Contains(err.Error(), "private diagnostic") {
			t.Fatal("leaked diagnostic")
		}
	}
}

func TestDiscoveryOtherPlatformsNeverQuery(t *testing.T) {
	for _, platform := range []string{"linux", "windows"} {
		apps, err := discover(context.Background(), platform, func(context.Context, string) (string, error) { t.Fatal("unexpected device query"); return "", nil })
		if err != nil || apps == nil || len(apps) != 0 {
			t.Fatalf("apps=%#v error=%v", apps, err)
		}
	}
}

func TestDiscoveryRejectsIncompleteMetadata(t *testing.T) {
	apps, err := decode(`[{"bundleID":"com.apple.Terminal","name":"","path":"/Terminal.app"},{"bundleID":"com.googlecode.iterm2","name":"iTerm","path":"relative.app"}]`)
	if err != nil || len(apps) != 0 {
		t.Fatalf("apps=%#v error=%v", apps, err)
	}
}

func TestDiscoveryOutputBoundReportsOverflow(t *testing.T) {
	var output boundedOutput
	payload := strings.Repeat("x", (2<<20)+1)
	n, err := output.Write([]byte(payload))
	if err != nil || n != len(payload) || !output.overflow || output.text.Len() != 2<<20 {
		t.Fatalf("n=%d error=%v overflow=%v size=%d", n, err, output.overflow, output.text.Len())
	}
}
