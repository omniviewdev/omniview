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

func TestReviewedSourcesMatchesPinnedBlobBytes(t *testing.T) {
	root, _ := sourceFixture(t)
	ctx := context.Background()
	for index, relative := range protectedFiles {
		content := []byte(fmt.Sprintf("file %d\n\x00%s blob 23\narbitrary bytes\n", index, strings.Repeat("a", 40)))
		if err := os.WriteFile(filepath.Join(root, relative), content, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := command(ctx, root, "add", "."); err != nil {
		t.Fatal(err)
	}
	if _, err := command(ctx, root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath="+os.DevNull, "commit", "-m", "binary baseline"); err != nil {
		t.Fatal(err)
	}
	raw, err := command(ctx, root, "rev-parse", "HEAD")
	if err != nil {
		t.Fatal(err)
	}
	revision := strings.TrimSpace(string(raw))
	baselines, err := reviewedSources(ctx, root, revision)
	if err != nil {
		t.Fatal(err)
	}
	for index, relative := range protectedFiles {
		want, err := command(ctx, root, "show", revision+":"+relative)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(baselines[index], want) {
			t.Fatalf("batch changed pinned blob bytes for %s", relative)
		}
	}
	if _, err = Verify(ctx, root, revision); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(root, protectedFiles[0]), []byte("changed after verification"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = Verify(ctx, root, revision); err == nil || !strings.Contains(err.Error(), "--allow-isolation-source-changes") {
		t.Fatalf("repeat verification trusted changed protected bytes: %v", err)
	}
}

func TestReviewedSourcesRejectsMissingAndTreeEntries(t *testing.T) {
	for _, kind := range []string{"missing", "tree"} {
		t.Run(kind, func(t *testing.T) {
			root, _ := sourceFixture(t)
			ctx := context.Background()
			relative := protectedFiles[0]
			if _, err := command(ctx, root, "rm", "--", relative); err != nil {
				t.Fatal(err)
			}
			if kind == "tree" {
				path := filepath.Join(root, relative, "nested")
				if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, []byte("not a baseline blob"), 0600); err != nil {
					t.Fatal(err)
				}
				if _, err := command(ctx, root, "add", "."); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := command(ctx, root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath="+os.DevNull, "commit", "-m", "invalid baseline"); err != nil {
				t.Fatal(err)
			}
			if _, err := reviewedSources(ctx, root, "HEAD"); err == nil || !strings.Contains(err.Error(), relative) {
				t.Fatalf("accepted %s baseline entry: %v", kind, err)
			}
		})
	}
}

func TestParseReviewedSourcesRejectsIncompleteAndNonBlobResponses(t *testing.T) {
	object := strings.Repeat("a", 40)
	entry := object + " blob 1\nx\n"
	valid := strings.Repeat(entry, len(protectedFiles))
	for name, raw := range map[string]string{
		"missing":        object + ":pkg/state/root.go missing\n",
		"tree":           object + " tree 1\nx\n",
		"short-header":   object + " blob",
		"negative-size":  object + " blob -1\nx\n",
		"overflow-size":  object + " blob 18446744073709551616\nx\n",
		"oversized-body": object + " blob 18446744073709551615\nx\n",
		"short-body":     object + " blob 2\nx\n",
		"bad-terminator": object + " blob 1\nxx",
		"missing-entry":  strings.Repeat(entry, len(protectedFiles)-1),
		"trailing":       valid + "unknown\n",
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := parseReviewedSources([]byte(raw)); err == nil {
				t.Fatal("accepted incomplete or non-blob baseline")
			}
		})
	}
	if files, err := parseReviewedSources([]byte(valid)); err != nil || len(files) != len(protectedFiles) {
		t.Fatalf("valid batch refused: %v", err)
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
	root, revision := sourceFixture(b)
	for index := range 256 {
		path := filepath.Join(root, "settings", fmt.Sprintf("api-%03d.go", index))
		if err := os.WriteFile(path, bytes.Repeat([]byte("source\n"), 512), 0600); err != nil {
			b.Fatal(err)
		}
	}
	for _, mode := range []string{"reviewed-blobs-individual", "reviewed-blobs-batch", "source-digest", "full-verification"} {
		b.Run(mode, func(b *testing.B) {
			b.ReportAllocs()
			for range b.N {
				var err error
				switch mode {
				case "reviewed-blobs-individual":
					for _, relative := range protectedFiles {
						if _, err = command(context.Background(), root, "show", revision+":"+relative); err != nil {
							break
						}
					}
				case "reviewed-blobs-batch":
					_, err = reviewedSources(context.Background(), root, revision)
				case "source-digest":
					_, err = sourceDigest(context.Background(), root)
				case "full-verification":
					_, err = Verify(context.Background(), root, revision)
				}
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
