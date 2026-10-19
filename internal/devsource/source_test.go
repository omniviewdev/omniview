package devsource

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func sourceFixture(t *testing.T) (string, string) {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	git := func(args ...string) string {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		cmd.Env = append(os.Environ(), "GOWORK=off", "GOFLAGS=", "GIT_CONFIG_NOSYSTEM=1")
		raw, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("git %v: %s: %v", args, raw, err)
		}
		return strings.TrimSpace(string(raw))
	}
	git("init")
	for _, relative := range []string{"pkg/state/root.go", "pkg/state/custom.go", "pkg/profilecontract/profile.go", "pkg/utils/store.go", "pkg/sdk/plugin.go", "settings/api.go", "go.mod"} {
		file := filepath.Join(root, relative)
		if err = os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(file, []byte("reviewed source fixture\n"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	git("add", ".")
	git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath="+os.DevNull, "commit", "-m", "reviewed fixture")
	return root, git("rev-parse", "HEAD")
}

func TestVerifyPermitsLiveSDKAPIEditsAndBindsExactDirtyContent(t *testing.T) {
	root, revision := sourceFixture(t)
	first, err := Verify(context.Background(), root, revision)
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(root, "settings/api.go")
	if err = os.WriteFile(source, []byte("real dirty API edit\n"), 0600); err != nil {
		t.Fatal(err)
	}
	dirty, err := Verify(context.Background(), root, revision)
	if err != nil {
		t.Fatal(err)
	}
	if first.SourceDigest == dirty.SourceDigest {
		t.Fatal("dirty bytes not bound to source identity")
	}
	if dirty.ReviewedRevision != revision {
		t.Fatal("dirty source misrepresented as another reviewed commit")
	}
	if err = os.WriteFile(filepath.Join(root, "settings/new.go"), []byte("new untracked API source\n"), 0600); err != nil {
		t.Fatal(err)
	}
	added, err := Verify(context.Background(), root, revision)
	if err != nil {
		t.Fatal(err)
	}
	if dirty.SourceDigest == added.SourceDigest {
		t.Fatal("untracked SDK source omitted")
	}
}

func TestVerifyIsolationCoreChangesRequireExplicitWorkspaceOptIn(t *testing.T) {
	for _, relative := range protectedFiles {
		t.Run(relative, func(t *testing.T) {
			root, revision := sourceFixture(t)
			if err := os.WriteFile(filepath.Join(root, relative), []byte("intentional isolation feature edit\n"), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := Verify(context.Background(), root, revision); err == nil || !strings.Contains(err.Error(), "--allow-isolation-source-changes") {
				t.Fatalf("missing explicit core conflict for %s: %v", relative, err)
			}
			identity, err := VerifyWithOptions(context.Background(), root, revision, VerifyOptions{AllowIsolationCoreChanges: true})
			if err != nil {
				t.Fatal(err)
			}
			if len(identity.SourceDigest) != 64 {
				t.Fatal("opt-in omitted exact source digest")
			}
		})
	}
}

func TestVerifyRejectsDirtySharedProfileContract(t *testing.T) {
	root, revision := sourceFixture(t)
	path := filepath.Join(root, "pkg/profilecontract/profile.go")
	if err := os.WriteFile(path, []byte("package profilecontract\n// weakened read-only ownership validation\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Verify(context.Background(), root, revision); err == nil || !strings.Contains(err.Error(), "pkg/profilecontract/profile.go") || !strings.Contains(err.Error(), "--allow-isolation-source-changes") {
		t.Fatalf("dirty shared ownership validator escaped reviewed-byte enforcement: %v", err)
	}
}

func TestSourceDigestExcludesIgnoredCachesButRejectsSourceAliases(t *testing.T) {
	root, revision := sourceFixture(t)
	if err := os.WriteFile(filepath.Join(root, ".gitignore"), []byte("ignored-cache/\n"), 0600); err != nil {
		t.Fatal(err)
	}
	before, err := Verify(context.Background(), root, revision)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(filepath.Join(root, "ignored-cache"), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(root, "ignored-cache/output"), []byte("cache"), 0600); err != nil {
		t.Fatal(err)
	}
	after, err := Verify(context.Background(), root, revision)
	if err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatal("ignored cache changed source identity")
	}
	if err = os.Symlink(filepath.Join(root, "go.mod"), filepath.Join(root, "settings/alias.go")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err = Verify(context.Background(), root, revision); err == nil {
		t.Fatal("aliased SDK source accepted")
	}
}

func TestVerifyRejectsUnreviewedBaselineAndNonAbsoluteSource(t *testing.T) {
	root, _ := sourceFixture(t)
	for _, revision := range []string{"main", strings.Repeat("f", 40), ""} {
		if _, err := Verify(context.Background(), root, revision); err == nil {
			t.Fatalf("accepted unreviewed identity %q", revision)
		}
	}
	if _, err := Verify(context.Background(), "relative", strings.Repeat("a", 40)); err == nil {
		t.Fatal("accepted ambient-relative source")
	}
}
