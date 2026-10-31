//go:build darwin

package devsession

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func standaloneClaimFixture(t *testing.T) (string, string) {
	t.Helper()
	t.Setenv("OMNIVIEW_WORKSPACE_FILE", "")
	t.Setenv("OMNIVIEW_STATE_DIR", "")
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	checkout := filepath.Join(root, "checkout with spaces")
	if err = os.Mkdir(checkout, 0700); err != nil {
		t.Fatal(err)
	}
	command := exec.Command("git", "init", "--quiet", checkout)
	if raw, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git init: %s %v", raw, err)
	}
	home := filepath.Join(root, "home")
	if err = os.Mkdir(home, 0700); err != nil {
		t.Fatal(err)
	}
	return checkout, home
}

func openClaimForTest(t *testing.T, checkout, home string, create bool) *StandaloneClaimHandle {
	t.Helper()
	h, err := OpenStandaloneClaim(context.Background(), checkout, home, create)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := h.Close(); err != nil {
			t.Error(err)
		}
	})
	return h
}

// SCN-DEV-003/004/019: aliases share physical identity; branch/source edits do
// not rekey owned state, while a different checkout receives another identity.
func TestStandaloneClaimAliasesAndCheckoutIdentity(t *testing.T) {
	checkout, home := standaloneClaimFixture(t)
	first := openClaimForTest(t, checkout, home, true)
	if first.Target.InstanceID == "" || first.Target.ClaimDigest == "" {
		t.Fatal("missing target identity")
	}
	before, err := os.ReadFile(filepath.Join(checkout, ".local", "dev-standalone", ".owner.json"))
	if err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(filepath.Dir(checkout), "alias")
	if err = os.Symlink(checkout, alias); err != nil {
		t.Fatal(err)
	}
	second := openClaimForTest(t, alias, home, false)
	if first.Target != second.Target {
		t.Fatal("same checkout alias got a different identity")
	}
	// A branch/source marker is provenance, never identity.
	if err = os.WriteFile(filepath.Join(checkout, "source-marker"), []byte("new branch input"), 0600); err != nil {
		t.Fatal(err)
	}
	third := openClaimForTest(t, checkout, home, true)
	if first.Target != third.Target {
		t.Fatal("source edit rekeyed claim")
	}
	after, _ := os.ReadFile(filepath.Join(checkout, ".local", "dev-standalone", ".owner.json"))
	if string(before) != string(after) {
		t.Fatal("reopen rewrote marker")
	}
	for _, name := range []string{"state", "runtime", "logs", "build"} {
		if _, err = os.Lstat(filepath.Join(checkout, ".local", "dev-standalone", name)); !os.IsNotExist(err) {
			t.Fatalf("claim unexpectedly created %s", name)
		}
	}
	other := filepath.Join(filepath.Dir(checkout), "other checkout")
	if raw, err := exec.Command("git", "init", "--quiet", other).CombinedOutput(); err != nil {
		t.Fatalf("git init: %s %v", raw, err)
	}
	fourth := openClaimForTest(t, other, home, true)
	if fourth.Target.InstanceID == first.Target.InstanceID {
		t.Fatal("different checkout reused identity")
	}
}

// SCN-DEV-012: no adoption/chmod/deletion of foreign or copied ownership.
func TestStandaloneClaimRefusesForeignContentAndRedirects(t *testing.T) {
	for _, kind := range []string{"unowned", "public-directory", "symlink-local", "symlink-boundary", "malformed", "unknown-version", "duplicate-field", "case-alias"} {
		t.Run(kind, func(t *testing.T) {
			checkout, home := standaloneClaimFixture(t)
			outside := filepath.Join(filepath.Dir(checkout), "outside")
			if err := os.Mkdir(outside, 0700); err != nil {
				t.Fatal(err)
			}
			sentinel := filepath.Join(outside, "sentinel")
			if err := os.WriteFile(sentinel, []byte("foreign unchanged"), 0600); err != nil {
				t.Fatal(err)
			}
			local := filepath.Join(checkout, ".local")
			boundary := filepath.Join(local, "dev-standalone")
			if kind == "symlink-local" {
				if err := os.Symlink(outside, local); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := os.Mkdir(local, 0700); err != nil {
					t.Fatal(err)
				}
				if kind == "symlink-boundary" {
					if err := os.Symlink(outside, boundary); err != nil {
						t.Fatal(err)
					}
				} else {
					if err := os.Mkdir(boundary, 0700); err != nil {
						t.Fatal(err)
					}
					switch kind {
					case "unowned":
						if err := os.WriteFile(filepath.Join(boundary, "foreign"), []byte("keep"), 0600); err != nil {
							t.Fatal(err)
						}
					case "public-directory":
						if err := os.Chmod(boundary, 0755); err != nil {
							t.Fatal(err)
						}
					default:
						claim := StandaloneClaim{SchemaVersion: 2, Checkout: checkout, PhysicalIdentity: "1:2", Nonce: strings.Repeat("a", 64)}
						raw, _ := json.Marshal(claim)
						switch kind {
						case "malformed":
							raw = []byte("not JSON")
						case "unknown-version":
							raw = []byte(strings.Replace(string(raw), `"schemaVersion":2`, `"schemaVersion":3`, 1))
						case "duplicate-field":
							raw = []byte(strings.TrimSuffix(string(raw), "}") + `,"nonce":"` + claim.Nonce + `"}`)
						case "case-alias":
							raw = []byte(strings.Replace(string(raw), `"nonce":`, `"Nonce":`, 1))
						}
						if err := os.WriteFile(filepath.Join(boundary, ".owner.json"), raw, 0600); err != nil {
							t.Fatal(err)
						}
					}
				}
			}
			if h, err := OpenStandaloneClaim(context.Background(), checkout, home, true); err == nil {
				h.Close()
				t.Fatal("claimed foreign destination")
			}
			raw, err := os.ReadFile(sentinel)
			if err != nil || string(raw) != "foreign unchanged" {
				t.Fatal("foreign sentinel changed")
			}
			if kind == "public-directory" {
				info, _ := os.Stat(boundary)
				if info.Mode().Perm() != 0755 {
					t.Fatal("foreign mode repaired")
				}
			}
		})
	}
}

func TestStandaloneClaimRefusesCopiedAndMovedMarker(t *testing.T) {
	checkout, home := standaloneClaimFixture(t)
	first := openClaimForTest(t, checkout, home, true)
	raw, err := os.ReadFile(filepath.Join(checkout, ".local", "dev-standalone", ".owner.json"))
	if err != nil {
		t.Fatal(err)
	}
	other := filepath.Join(filepath.Dir(checkout), "copied checkout")
	if result, err := exec.Command("git", "init", "--quiet", other).CombinedOutput(); err != nil {
		t.Fatalf("git init: %s %v", result, err)
	}
	destination := filepath.Join(other, ".local", "dev-standalone")
	if err = os.MkdirAll(destination, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(destination, ".owner.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	if h, err := OpenStandaloneClaim(context.Background(), other, home, true); err == nil {
		h.Close()
		t.Fatal("copied claim accepted")
	}
	moved := checkout + " moved"
	if err = os.Rename(checkout, moved); err != nil {
		t.Fatal(err)
	}
	if err = first.Revalidate(home); err == nil {
		t.Fatal("retained handle accepted moved checkout")
	}
	if h, err := OpenStandaloneClaim(context.Background(), moved, home, true); err == nil {
		h.Close()
		t.Fatal("moved claim accepted")
	}
}

// SCN-DEV-011/012: barriers replace a parent/component after preflight. A
// retained root must refuse the new pathname, without writing the replacement.
func TestStandaloneClaimRevalidatesReplacedObjects(t *testing.T) {
	for _, component := range []string{".local", ".local/dev-standalone"} {
		t.Run(component, func(t *testing.T) {
			checkout, home := standaloneClaimFixture(t)
			h := openClaimForTest(t, checkout, home, true)
			path := filepath.Join(checkout, component)
			if err := os.Rename(path, path+"-retained"); err != nil {
				t.Fatal(err)
			}
			if err := os.Mkdir(path, 0700); err != nil {
				t.Fatal(err)
			}
			if err := h.Revalidate(home); err == nil {
				t.Fatal("replaced directory accepted")
			}
			entries, err := os.ReadDir(path)
			if err != nil || len(entries) != 0 {
				t.Fatal("replacement modified")
			}
		})
	}
}

func TestStandaloneClaimConcurrentCreationAndStableGuards(t *testing.T) {
	checkout, home := standaloneClaimFixture(t)
	const callers = 8
	var group sync.WaitGroup
	identities := make(chan string, callers)
	failures := make(chan error, callers)
	for n := 0; n < callers; n++ {
		group.Add(1)
		go func() {
			defer group.Done()
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			h, err := OpenStandaloneClaim(ctx, checkout, home, true)
			if err != nil {
				failures <- err
				return
			}
			identities <- h.Target.InstanceID
			h.Close()
		}()
	}
	group.Wait()
	close(failures)
	close(identities)
	for err := range failures {
		t.Error(err)
	}
	var identity string
	for id := range identities {
		if identity != "" && id != identity {
			t.Fatal("concurrent claims differ")
		}
		identity = id
	}
	h := openClaimForTest(t, checkout, home, false)
	guard, err := h.TargetGuard(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(home, ".omniview-dev", "locks", h.Target.InstanceID+".lock")
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	if other, err := h.TargetGuard(ctx); err == nil {
		other.Close()
		t.Fatal("second target guard acquired")
	}
	if err = guard.Close(); err != nil {
		t.Fatal(err)
	}
	again, err := h.TargetGuard(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err = again.Close(); err != nil {
		t.Fatal(err)
	}
	after, err := os.Stat(path)
	if err != nil || !os.SameFile(before, after) {
		t.Fatal("stable guard inode changed")
	}
}

func TestStandaloneClaimRefusesExplicitInvalidManagedAndStateContext(t *testing.T) {
	for _, key := range []string{"OMNIVIEW_WORKSPACE_FILE", "OMNIVIEW_STATE_DIR"} {
		t.Run(key, func(t *testing.T) {
			checkout, home := standaloneClaimFixture(t)
			t.Setenv(key, filepath.Join(home, "missing"))
			if h, err := OpenStandaloneClaim(context.Background(), checkout, home, true); err == nil {
				h.Close()
				t.Fatal("invalid context downgraded")
			}
			if _, err := os.Lstat(filepath.Join(checkout, ".local")); !os.IsNotExist(err) {
				t.Fatal("invalid context wrote checkout")
			}
		})
	}
}

func TestStandaloneClaimSessionGuardRefusesDuplicateAndRetainsInode(t *testing.T) {
	checkout, home := standaloneClaimFixture(t)
	h := openClaimForTest(t, checkout, home, true)
	guard, err := h.SessionGuard(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(home, ".omniview-dev", "locks", h.Target.InstanceID+"-session.lock")
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if duplicate, err := h.SessionGuard(context.Background()); err == nil {
		duplicate.Close()
		t.Fatal("duplicate live owner admitted")
	}
	if err = guard.Close(); err != nil {
		t.Fatal(err)
	}
	next, err := h.SessionGuard(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err = next.Close(); err != nil {
		t.Fatal(err)
	}
	after, err := os.Stat(path)
	if err != nil || !os.SameFile(before, after) {
		t.Fatal("session guard inode changed")
	}
}

func TestStandaloneClaimRefusesTrackedDestination(t *testing.T) {
	checkout, home := standaloneClaimFixture(t)
	destination := filepath.Join(checkout, ".local", "dev-standalone")
	if err := os.MkdirAll(destination, 0700); err != nil {
		t.Fatal(err)
	}
	sentinel := filepath.Join(destination, "tracked-source")
	if err := os.WriteFile(sentinel, []byte("preserved"), 0600); err != nil {
		t.Fatal(err)
	}
	if raw, err := exec.Command("git", "-C", checkout, "add", "-f", ".local/dev-standalone/tracked-source").CombinedOutput(); err != nil {
		t.Fatalf("git add: %s %v", raw, err)
	}
	if h, err := OpenStandaloneClaim(context.Background(), checkout, home, true); err == nil {
		h.Close()
		t.Fatal("tracked destination accepted")
	}
	if raw, err := os.ReadFile(sentinel); err != nil || string(raw) != "preserved" {
		t.Fatal("tracked source changed")
	}
	if _, err := os.Lstat(filepath.Join(home, ".omniview-dev")); !os.IsNotExist(err) {
		t.Fatal("tracked refusal created external metadata")
	}
}

func TestStandaloneClaimRefusesGuardSymlinkAndParentReplacement(t *testing.T) {
	for _, kind := range []string{"symlink", "parent"} {
		t.Run(kind, func(t *testing.T) {
			checkout, home := standaloneClaimFixture(t)
			h := openClaimForTest(t, checkout, home, true)
			locks := filepath.Join(home, ".omniview-dev", "locks")
			outside := filepath.Join(home, "sentinel")
			if err := os.WriteFile(outside, []byte("preserved"), 0644); err != nil {
				t.Fatal(err)
			}
			if kind == "symlink" {
				if err := os.Symlink(outside, filepath.Join(locks, h.Target.InstanceID+".lock")); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := os.Rename(locks, locks+"-retained"); err != nil {
					t.Fatal(err)
				}
				if err := os.Mkdir(locks, 0700); err != nil {
					t.Fatal(err)
				}
			}
			if guard, err := h.TargetGuard(context.Background()); err == nil {
				guard.Close()
				t.Fatal("foreign guard admitted")
			}
			if raw, err := os.ReadFile(outside); err != nil || string(raw) != "preserved" {
				t.Fatal("foreign sentinel changed")
			}
			info, err := os.Stat(outside)
			if err != nil || info.Mode().Perm() != 0644 {
				t.Fatal("foreign sentinel chmodded")
			}
			if kind == "parent" {
				entries, err := os.ReadDir(locks)
				if err != nil || len(entries) != 0 {
					t.Fatal("replacement guard directory changed")
				}
			}
		})
	}
}

func TestStandaloneClaimRejectsChangedClaimAndPermissions(t *testing.T) {
	for _, kind := range []string{"claim", "target", "mode"} {
		t.Run(kind, func(t *testing.T) {
			checkout, home := standaloneClaimFixture(t)
			h := openClaimForTest(t, checkout, home, true)
			switch kind {
			case "claim":
				claim := h.Claim
				claim.Nonce = strings.Repeat("c", 64)
				raw, _ := json.Marshal(claim)
				if err := os.WriteFile(filepath.Join(checkout, ".local", "dev-standalone", ".owner.json"), raw, 0600); err != nil {
					t.Fatal(err)
				}
			case "target":
				h.Target.InstanceID = "standalone-" + strings.Repeat("d", 64)
			case "mode":
				if err := os.Chmod(filepath.Join(checkout, ".local", "dev-standalone"), 0755); err != nil {
					t.Fatal(err)
				}
			}
			if err := h.Revalidate(home); err == nil {
				t.Fatal("changed ownership admitted")
			}
		})
	}
}
