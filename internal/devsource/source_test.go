package devsource

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func sourceFixture(t testing.TB) (string, string) {
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
	first, err := Verify(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(root, "settings/api.go")
	if err = os.WriteFile(source, []byte("real dirty API edit\n"), 0600); err != nil {
		t.Fatal(err)
	}
	dirty, err := Verify(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if first.SourceDigest == dirty.SourceDigest {
		t.Fatal("dirty bytes not bound to source identity")
	}
	if dirty.Revision != revision {
		t.Fatal("checkout HEAD not recorded")
	}
	if err = os.WriteFile(filepath.Join(root, "pkg/state/root.go"), []byte("dirty state source\n"), 0600); err != nil {
		t.Fatal(err)
	}
	stateDirty, err := Verify(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if stateDirty.SourceDigest == dirty.SourceDigest {
		t.Fatal("dirty state source omitted")
	}
	if err = os.WriteFile(filepath.Join(root, "settings/new.go"), []byte("new untracked API source\n"), 0600); err != nil {
		t.Fatal(err)
	}
	added, err := Verify(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if stateDirty.SourceDigest == added.SourceDigest {
		t.Fatal("untracked SDK source omitted")
	}
}

func TestSourceDigestExcludesIgnoredCachesButRejectsSourceAliases(t *testing.T) {
	root, _ := sourceFixture(t)
	if err := os.WriteFile(filepath.Join(root, ".gitignore"), []byte("ignored-cache/\n"), 0600); err != nil {
		t.Fatal(err)
	}
	before, err := Verify(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.MkdirAll(filepath.Join(root, "ignored-cache"), 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(root, "ignored-cache/output"), []byte("cache"), 0600); err != nil {
		t.Fatal(err)
	}
	after, err := Verify(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatal("ignored cache changed source identity")
	}
	if err = os.Symlink(filepath.Join(root, "go.mod"), filepath.Join(root, "settings/alias.go")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err = Verify(context.Background(), root); err == nil {
		t.Fatal("aliased SDK source accepted")
	}
}

func TestVerifyRejectsNonAbsoluteSource(t *testing.T) {
	if _, err := Verify(context.Background(), "relative"); err == nil {
		t.Fatal("accepted ambient-relative source")
	}
}

func TestSourceDigestKeepsExactFramingAcrossScratchReuse(t *testing.T) {
	root, _ := sourceFixture(t)
	for name, content := range map[string][]byte{
		"settings/api.go": []byte{},
		"settings/new.go": bytes.Repeat([]byte("new\n\x00"), 20000),
	} {
		if err := os.WriteFile(filepath.Join(root, name), content, 0600); err != nil {
			t.Fatal(err)
		}
	}
	deleted := "pkg/sdk/plugin.go"
	if err := os.Remove(filepath.Join(root, deleted)); err != nil {
		t.Fatal(err)
	}
	want := sha256.New()
	fmt.Fprint(want, "omniview-sdk-source-v1\x00")
	for _, name := range []string{"go.mod", "pkg/profilecontract/profile.go", deleted, "pkg/state/custom.go", "pkg/state/root.go", "pkg/utils/store.go", "settings/api.go", "settings/new.go"} {
		file := filepath.Join(root, filepath.FromSlash(name))
		info, err := os.Lstat(file)
		if os.IsNotExist(err) {
			fmt.Fprintf(want, "deleted\x00%s\x00", name)
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		content, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		fmt.Fprintf(want, "file\x00%s\x00%o\x00%d\x00", name, info.Mode().Perm(), info.Size())
		_, _ = want.Write(content)
		_, _ = io.WriteString(want, "\x00")
	}
	got, err := sourceDigest(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if got != hex.EncodeToString(want.Sum(nil)) {
		t.Fatal("reused scratch changed source digest framing")
	}
}

func BenchmarkSDKVerification(b *testing.B) {
	root, _ := sourceFixture(b)
	for index := range 256 {
		path := filepath.Join(root, "settings", fmt.Sprintf("api-%03d.go", index))
		if err := os.WriteFile(path, bytes.Repeat([]byte("source\n"), 512), 0600); err != nil {
			b.Fatal(err)
		}
	}
	for _, mode := range []string{"source-digest", "full-verification"} {
		b.Run(mode, func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				var err error
				switch mode {
				case "source-digest":
					_, err = sourceDigest(context.Background(), root)
				case "full-verification":
					_, err = Verify(context.Background(), root)
				}
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func TestVerifyReturnsOnlyValidIdentities(t *testing.T) {
	root, _ := sourceFixture(t)
	identity, err := Verify(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	if err = identity.Validate(); err != nil {
		t.Fatalf("Verify returned an identity its own validator rejects: %v", err)
	}
	for name, mutate := range map[string]func(*Identity){
		"relative directory": func(i *Identity) { i.Directory = "sdk" },
		"unclean directory":  func(i *Identity) { i.Directory += string(filepath.Separator) },
		"missing revision":   func(i *Identity) { i.Revision = "" },
		"uppercase revision": func(i *Identity) { i.Revision = strings.Repeat("A", 40) },
		"missing digest":     func(i *Identity) { i.SourceDigest = "" },
		"short digest":       func(i *Identity) { i.SourceDigest = i.SourceDigest[1:] },
	} {
		incomplete := identity
		mutate(&incomplete)
		if incomplete.Validate() == nil {
			t.Fatalf("%s was accepted as a complete source identity", name)
		}
	}
}
