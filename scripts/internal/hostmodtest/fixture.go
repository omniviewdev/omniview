// Package hostmodtest supplies real offline Go module graphs for tooling tests.
package hostmodtest

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/mod/sumdb/dirhash"
)

const WailsModule = "github.com/wailsapp/wails/v3"
const WailsVersion = "v3.0.0-beta.34"

// Root supplies a checksum-trusted stock module through a private file proxy.
// The fixture module is intentionally tiny; cmd/go still performs real module
// graph selection, downloads and checksum verification.
func Root(t testing.TB, root string) (requirement, sums string) {
	t.Helper()
	proxy := t.TempDir()
	proxyPath := filepath.ToSlash(proxy)
	if !strings.HasPrefix(proxyPath, "/") {
		proxyPath = "/" + proxyPath
	}
	t.Setenv("GOPROXY", (&url.URL{Scheme: "file", Path: proxyPath}).String())
	t.Setenv("GOSUMDB", "off")
	t.Setenv("GONOSUMDB", "*")
	t.Setenv("GONOPROXY", "none")
	cache, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	original, err := os.Lstat(cache)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("GOMODCACHE", cache)
	t.Cleanup(func() {
		current, err := os.Lstat(cache)
		if err != nil || !os.SameFile(original, current) {
			t.Errorf("private module cache identity changed before cleanup: %v", err)
			return
		}
		if err := writableCacheDirectories(cache); err != nil {
			t.Errorf("private module cache cleanup: %v", err)
		}
	})
	sum, modSum := Module(t, proxy, WailsModule, WailsVersion, "module "+WailsModule+"\n\ngo 1.20\n")
	requirement = "require " + WailsModule + " " + WailsVersion + "\n"
	sums = fmt.Sprintf("%s %s %s\n%s %s/go.mod %s\n", WailsModule, WailsVersion, sum, WailsModule, WailsVersion, modSum)
	Write(t, filepath.Join(root, "go.mod"), "module github.com/omniviewdev/omniview\n\ngo 1.20\n"+requirement)
	Write(t, filepath.Join(root, "go.sum"), sums)
	return requirement, sums
}

// Module publishes a real module archive and returns cmd/go-compatible hashes.
func Module(t testing.TB, proxy, module, version, mod string) (sum, modSum string) {
	t.Helper()
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	entry, err := writer.Create(module + "@" + version + "/go.mod")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.WriteString(entry, mod); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	base := filepath.Join(proxy, filepath.FromSlash(module), "@v", version)
	Write(t, base+".mod", mod)
	Write(t, base+".info", fmt.Sprintf("{\"Version\":%q,\"Time\":\"2026-10-22T00:00:00Z\"}\n", version))
	Write(t, base+".zip", archive.String())
	sum, err = dirhash.HashZip(base+".zip", dirhash.Hash1)
	if err != nil {
		t.Fatal(err)
	}
	modSum, err = dirhash.Hash1([]string{"go.mod"}, func(string) (io.ReadCloser, error) { return io.NopCloser(bytes.NewBufferString(mod)), nil })
	if err != nil {
		t.Fatal(err)
	}
	return sum, modSum
}
func Write(t testing.TB, path, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0600); err != nil {
		t.Fatal(err)
	}
}

// Only restore owner directory permissions inside this fixture's captured
// private cache. Module files and symlinks (including their targets) are untouched.
func writableCacheDirectories(path string) error {
	before, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if before.Mode()&os.ModeSymlink != 0 || !before.IsDir() {
		return nil
	}
	canonical, err := filepath.EvalSymlinks(path)
	if err != nil {
		return err
	}
	if canonical != path {
		return fmt.Errorf("private cache directory is redirected: %s", path)
	}
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	opened, err := directory.Stat()
	if err != nil {
		return err
	}
	if !opened.IsDir() || !os.SameFile(before, opened) {
		return fmt.Errorf("private cache directory changed while opening: %s", path)
	}
	if opened.Mode().Perm()&0700 != 0700 {
		if err := directory.Chmod(opened.Mode().Perm() | 0700); err != nil {
			return err
		}
	}
	entries, err := directory.ReadDir(-1)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			if err := writableCacheDirectories(filepath.Join(path, entry.Name())); err != nil {
				return err
			}
		}
	}
	return nil
}
