package devsource

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestVerifyUpstreamCommitRejectsProtectedChangesWithoutCheckout(t *testing.T) {
	for _, relative := range append(append([]string{}, protectedFiles...), "settings/api.go") {
		t.Run(relative, func(t *testing.T) {
			checkUpstreamProtectedChange(t, relative)
		})
	}
}

func checkUpstreamProtectedChange(t *testing.T, relative string) {
	t.Helper()
	root, baseline := sourceFixture(t)
	ctx := context.Background()
	if err := os.WriteFile(filepath.Join(root, relative), []byte("upstream revision\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := command(ctx, root, "add", "--", relative); err != nil {
		t.Fatal(err)
	}
	if _, err := command(ctx, root,
		"-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
		"-c", "commit.gpgsign=false", "-c", "core.hooksPath="+os.DevNull,
		"commit", "-m", "upstream"); err != nil {
		t.Fatal(err)
	}
	raw, err := command(ctx, root, "rev-parse", "HEAD")
	if err != nil {
		t.Fatal(err)
	}
	target := strings.TrimSpace(string(raw))
	if _, err = command(ctx, root, "checkout", "--detach", baseline); err != nil {
		t.Fatal(err)
	}
	err = VerifyUpstreamCommit(ctx, root, baseline, target, VerifyOptions{})
	if relative == "settings/api.go" && err != nil {
		t.Fatal(err)
	}
	if relative != "settings/api.go" && err == nil {
		t.Fatal("accepted protected upstream changes")
	}
	options := VerifyOptions{AllowIsolationCoreChanges: true}
	if err = VerifyUpstreamCommit(ctx, root, baseline, target, options); err != nil {
		t.Fatal(err)
	}
	actual, err := command(ctx, root, "rev-parse", "HEAD")
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(actual)) != baseline {
		t.Fatal("preflight changed checkout")
	}
}
