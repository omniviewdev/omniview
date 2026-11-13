package gateway_test

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/auditgate/gateway"
	"github.com/omniviewdev/omniview/internal/devsession"
)

// privateDir makes a directory the way the supervisor makes its runtime
// directories and returns its canonical path.
func privateDir(t *testing.T) string {
	t.Helper()
	dir, err := devsession.EnsurePrivateDirectory(filepath.Join(t.TempDir(), "audit"))
	if err != nil {
		t.Fatal(err)
	}
	return dir
}

func issued() gateway.IssuedCredential {
	return gateway.IssuedCredential{
		AuditID: "0123456789abcdef0123456789abcdef", CredentialID: "fedcba9876543210",
		Username: "0011223344556677", Secret: []byte(strings.Repeat("s", 43)),
	}
}

func TestACredentialReachesTheBrowserThroughAPrivateFile(t *testing.T) {
	h := newHarness(t)
	dir := privateDir(t)
	channel, err := gateway.NewFileChannel(dir)
	if err != nil {
		t.Fatal(err)
	}
	offer, err := h.gw.NewPairing(gateway.PairingOptions{})
	if err != nil {
		t.Fatal(err)
	}
	info, err := h.gw.Exchange(t.Context(), offer.Code, channel, gateway.ExchangeOptions{})
	if err != nil {
		t.Fatal(err)
	}

	want := filepath.Join(dir, "audit-"+h.gw.ID()+"-"+info.ID+".secret")
	if channel.Path() != want {
		t.Fatalf("file at %q, want %q", channel.Path(), want)
	}
	content, err := os.ReadFile(channel.Path())
	if err != nil {
		t.Fatal(err)
	}
	if len(content) != 43 || bytes.ContainsAny(content, "\r\n ") {
		t.Fatalf("file holds %q: want the password alone, with no newline", content)
	}
	if runtime.GOOS != "windows" {
		stat, statErr := os.Stat(channel.Path())
		if statErr != nil {
			t.Fatal(statErr)
		}
		if mode := stat.Mode().Perm(); mode != 0o600 {
			t.Fatalf("file mode %v, want 0600", mode)
		}
	}
	if err = devsession.ValidatePrivateFile(channel.Path()); err != nil {
		t.Fatalf("the credential file is not private by the devsession standard: %v", err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("directory holds %d entries, want only the credential file", len(entries))
	}

	// What the file holds is the password.
	b := h.browser(laptop, credential{info: info, username: info.Username, secret: string(content)})
	if res := b.get("/"); res.status != http.StatusOK {
		t.Fatalf("browser using the file's password = %d", res.status)
	}
}

func TestACredentialFileIsNeverReplaced(t *testing.T) {
	dir := privateDir(t)
	credential := issued()
	path, err := gateway.WriteCredentialFile(dir, credential)
	if err != nil {
		t.Fatal(err)
	}
	other := issued()
	other.Secret = []byte(strings.Repeat("t", 43))
	if _, err = gateway.WriteCredentialFile(dir, other); !errors.Is(err, gateway.ErrCredentialFileExists) {
		t.Fatalf("second write = %v, want ErrCredentialFileExists", err)
	}
	content, err := os.ReadFile(path)
	if err != nil || string(content) != strings.Repeat("s", 43) {
		t.Fatalf("the first credential's file changed: %q, %v", content, err)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatalf("a failed write left %d entries behind", len(entries))
	}
}

func TestCredentialFilesNeedAPrivateDirectory(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("directory modes are checked through ACLs on Windows")
	}
	root := t.TempDir()
	cases := map[string]func(t *testing.T) string{
		"missing": func(*testing.T) string { return filepath.Join(root, "missing") },
		"world readable": func(t *testing.T) string {
			dir := privateDir(t)
			if err := os.Chmod(dir, 0o755); err != nil {
				t.Fatal(err)
			}
			return dir
		},
		"a file": func(t *testing.T) string {
			path := filepath.Join(root, "file")
			if err := os.WriteFile(path, nil, 0o600); err != nil {
				t.Fatal(err)
			}
			return path
		},
		"a link": func(t *testing.T) string {
			link := filepath.Join(root, "link")
			if err := os.Symlink(privateDir(t), link); err != nil {
				t.Fatal(err)
			}
			return link
		},
	}
	for name, build := range cases {
		dir := build(t)
		if _, err := gateway.NewFileChannel(dir); err == nil {
			t.Errorf("%s: NewFileChannel accepted %s", name, dir)
		}
		if _, err := gateway.WriteCredentialFile(dir, issued()); err == nil {
			t.Errorf("%s: WriteCredentialFile wrote into %s", name, dir)
		}
	}
}

func TestCredentialFileNamesAndSecretsAreValidated(t *testing.T) {
	dir := privateDir(t)
	bad := map[string]func(*gateway.IssuedCredential){
		"path in audit ID":      func(c *gateway.IssuedCredential) { c.AuditID = "../../etc" },
		"path in credential ID": func(c *gateway.IssuedCredential) { c.CredentialID = "a/b" },
		"empty credential ID":   func(c *gateway.IssuedCredential) { c.CredentialID = "" },
		"upper case ID":         func(c *gateway.IssuedCredential) { c.CredentialID = "ABCDEF" },
		"short secret":          func(c *gateway.IssuedCredential) { c.Secret = []byte("short") },
		"no secret":             func(c *gateway.IssuedCredential) { c.Secret = nil },
	}
	for name, mutate := range bad {
		credential := issued()
		mutate(&credential)
		if _, err := gateway.WriteCredentialFile(dir, credential); err == nil {
			t.Errorf("%s: written", name)
		}
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Fatalf("rejected credentials left %d files", len(entries))
	}
}

func TestACanceledDeliveryWritesNothing(t *testing.T) {
	dir := privateDir(t)
	channel, err := gateway.NewFileChannel(dir)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if err = channel.Deliver(ctx, issued()); err == nil {
		t.Fatal("Deliver succeeded on a canceled context")
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatalf("a canceled delivery left %d files", len(entries))
	}
	if channel.Path() != "" {
		t.Fatalf("Path = %q before any delivery", channel.Path())
	}
}
