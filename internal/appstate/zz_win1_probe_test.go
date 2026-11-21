//go:build windows

package appstate

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// Throwaway probe (wip branch only): what does a Windows directory handle of each
// flavour do to the renames and removals an uninstall or an update makes?

type probeCase struct {
	name string
	open func(t *testing.T, plugins string) (cleanup func())
}

func probeLayout(t *testing.T) string {
	t.Helper()
	plugins := filepath.Join(t.TempDir(), "plugins")
	for _, dir := range []string{"store", "data", "bin"} {
		if err := os.MkdirAll(filepath.Join(plugins, "flux", dir), 0o700); err != nil {
			t.Fatal(err)
		}
	}
	for _, file := range []string{"plugin.yaml", "store/kept", "data/kept", "bin/plugin.exe"} {
		if err := os.WriteFile(filepath.Join(plugins, "flux", filepath.FromSlash(file)), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return plugins
}

func status(err error) string {
	if err == nil {
		return "ok"
	}
	return fmt.Sprintf("FAIL(%v)", err)
}

func probeCases() []probeCase {
	return []probeCase{
		{"none", func(t *testing.T, plugins string) func() { return func() {} }},
		{"top-level os.OpenRoot(flux/store)", func(t *testing.T, plugins string) func() {
			r, err := os.OpenRoot(filepath.Join(plugins, "flux", "store"))
			if err != nil {
				t.Fatal(err)
			}
			return func() { r.Close() }
		}},
		{"sub-root plugins.OpenRoot(flux/store)", func(t *testing.T, plugins string) func() {
			top, err := os.OpenRoot(plugins)
			if err != nil {
				t.Fatal(err)
			}
			r, err := top.OpenRoot("flux/store")
			if err != nil {
				t.Fatal(err)
			}
			return func() { r.Close(); top.Close() }
		}},
		{"sub-root two steps plugins.OpenRoot(flux).OpenRoot(store)", func(t *testing.T, plugins string) func() {
			top, err := os.OpenRoot(plugins)
			if err != nil {
				t.Fatal(err)
			}
			mid, err := top.OpenRoot("flux")
			if err != nil {
				t.Fatal(err)
			}
			r, err := mid.OpenRoot("store")
			if err != nil {
				t.Fatal(err)
			}
			return func() { r.Close(); mid.Close(); top.Close() }
		}},
		{"sub-root only flux (plugins.OpenRoot(flux))", func(t *testing.T, plugins string) func() {
			top, err := os.OpenRoot(plugins)
			if err != nil {
				t.Fatal(err)
			}
			r, err := top.OpenRoot("flux")
			if err != nil {
				t.Fatal(err)
			}
			return func() { r.Close(); top.Close() }
		}},
		{"file held via sub-root store/kept (os.File through Root.OpenFile)", func(t *testing.T, plugins string) func() {
			top, err := os.OpenRoot(plugins)
			if err != nil {
				t.Fatal(err)
			}
			f, err := top.OpenFile("flux/store/kept", os.O_RDWR, 0)
			if err != nil {
				t.Fatal(err)
			}
			return func() { f.Close(); top.Close() }
		}},
		{"file held via os.Open(flux/store/kept)", func(t *testing.T, plugins string) func() {
			f, err := os.Open(filepath.Join(plugins, "flux", "store", "kept"))
			if err != nil {
				t.Fatal(err)
			}
			return func() { f.Close() }
		}},
	}
}

func TestWin1ProbeRenames(t *testing.T) {
	for _, pc := range probeCases() {
		t.Run(pc.name, func(t *testing.T) {
			// R1: os.Rename of the plugin directory.
			{
				plugins := probeLayout(t)
				cleanup := pc.open(t, plugins)
				err := os.Rename(filepath.Join(plugins, "flux"), filepath.Join(plugins, "flux-moved"))
				t.Logf("PROBE [%s] R1 os.Rename(flux -> flux-moved): %s", pc.name, status(err))
				if err == nil {
					// D1: delete the moved tree.
					rerr := os.RemoveAll(filepath.Join(plugins, "flux-moved"))
					_, serr := os.Stat(filepath.Join(plugins, "flux-moved"))
					t.Logf("PROBE [%s] D1 os.RemoveAll(flux-moved): %s; stat after: %v", pc.name, status(rerr), serr)
					merr := os.Mkdir(filepath.Join(plugins, "flux"), 0o700)
					t.Logf("PROBE [%s] D2 os.Mkdir(flux) afterwards: %s", pc.name, status(merr))
				}
				cleanup()
			}
			// R2: the product's native handle-relative no-replace rename.
			{
				plugins := probeLayout(t)
				cleanup := pc.open(t, plugins)
				sr, err := newScopedRoot(plugins)
				if err != nil {
					t.Fatal(err)
				}
				stage, err := sr.MkdirTemp(".uninstall-flux-")
				if err != nil {
					t.Fatal(err)
				}
				err = sr.RenameDirectoryNoReplace("flux", filepath.Join(stage, "plugin"))
				t.Logf("PROBE [%s] R2 RenameDirectoryNoReplace(flux -> stage/plugin): %s", pc.name, status(err))
				if err == nil {
					rerr := sr.RemoveAll(stage)
					t.Logf("PROBE [%s] D3 ScopedRoot.RemoveAll(stage): %s", pc.name, status(rerr))
				}
				sr.Close()
				cleanup()
			}
			// R3: moving the state directory itself, as an archive replacement does.
			{
				plugins := probeLayout(t)
				cleanup := pc.open(t, plugins)
				err := os.Rename(filepath.Join(plugins, "flux", "store"), filepath.Join(plugins, "flux", "store-moved"))
				t.Logf("PROBE [%s] R3 os.Rename(flux/store -> flux/store-moved): %s", pc.name, status(err))
				cleanup()
			}
			// R4: native rename of the state directory into another plugin directory.
			{
				plugins := probeLayout(t)
				if err := os.MkdirAll(filepath.Join(plugins, "flux-new"), 0o700); err != nil {
					t.Fatal(err)
				}
				cleanup := pc.open(t, plugins)
				sr, err := newScopedRoot(plugins)
				if err != nil {
					t.Fatal(err)
				}
				err = sr.RenameDirectoryNoReplace(filepath.Join("flux", "store"), filepath.Join("flux-new", "store"))
				t.Logf("PROBE [%s] R4 RenameDirectoryNoReplace(flux/store -> flux-new/store): %s", pc.name, status(err))
				sr.Close()
				cleanup()
			}
		})
	}
}

// A root opened through another root keeps working after the directory moved.
func TestWin1ProbeSubRootFollowsTheDirectory(t *testing.T) {
	plugins := probeLayout(t)
	top, err := os.OpenRoot(plugins)
	if err != nil {
		t.Fatal(err)
	}
	defer top.Close()
	store, err := top.OpenRoot("flux/store")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	err = os.Rename(filepath.Join(plugins, "flux"), filepath.Join(plugins, "flux-moved"))
	t.Logf("PROBE sub-root follows: rename flux -> flux-moved: %s", status(err))
	if err != nil {
		return
	}
	werr := store.WriteFile("after-move", []byte("y"), 0o600)
	_, serr := os.Stat(filepath.Join(plugins, "flux-moved", "store", "after-move"))
	t.Logf("PROBE sub-root follows: write through held root: %s; file in moved dir: %s", status(werr), status(serr))
	_, serr = os.Stat(filepath.Join(plugins, "flux", "store", "after-move"))
	t.Logf("PROBE sub-root follows: file at old path: %v", serr)
	rerr := os.RemoveAll(filepath.Join(plugins, "flux-moved"))
	t.Logf("PROBE sub-root follows: RemoveAll(flux-moved) with the root still open: %s", status(rerr))
	_, serr = os.Stat(filepath.Join(plugins, "flux-moved"))
	t.Logf("PROBE sub-root follows: stat flux-moved after: %v", serr)
	werr = store.WriteFile("after-remove", []byte("z"), 0o600)
	t.Logf("PROBE sub-root follows: write through held root after removal: %s", status(werr))
	_, serr = os.Stat(filepath.Join(plugins, "flux-moved"))
	t.Logf("PROBE sub-root follows: stat flux-moved after the write: %v", serr)
	merr := os.MkdirAll(filepath.Join(plugins, "flux", "store"), 0o700)
	t.Logf("PROBE sub-root follows: recreate flux/store at the old path: %s", status(merr))
}
