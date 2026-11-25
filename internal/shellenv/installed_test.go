package shellenv

import (
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"testing"
)

// shellFile makes an executable file called name in dir: a fake installation, found the way a real one is.
func shellFile(t *testing.T, dir, name string, mode os.FileMode) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"), mode); err != nil {
		t.Fatal(err)
	}
	return path
}

func paths(shells []Shell) []string {
	out := make([]string, 0, len(shells))
	for _, shell := range shells {
		out = append(out, shell.Path)
	}
	return out
}

func skipOnWindows(t *testing.T) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("the standard directories and the executable bit are the Unix ones")
	}
}

func TestListFindsEachInstalledShellOfTheOfferedNamesInTheOrderOfTheNames(t *testing.T) {
	skipOnWindows(t)
	first, second := t.TempDir(), t.TempDir()
	zsh := shellFile(t, first, "zsh", 0o755)
	bash := shellFile(t, second, "bash", 0o755)
	fish := shellFile(t, second, "fish", 0o755)
	shellFile(t, first, "dash", 0o755) // a shell the host starts, but not one that is offered
	shellFile(t, first, "vim", 0o755)  // not a shell at all

	got := listIn([]string{first, second}, "")
	if want := []string{bash, zsh, fish}; !slices.Equal(paths(got), want) {
		t.Fatalf("shells listed %v, want %v (bash, zsh, fish, pwsh, whichever directory holds them)", paths(got), want)
	}
	for _, shell := range got {
		if shell.Name != filepath.Base(shell.Path) {
			t.Fatalf("%s is named %q: the name is the shell's own", shell.Path, shell.Name)
		}
		if shell.Default {
			t.Fatalf("%s is marked the default and no default was given", shell.Path)
		}
	}
}

func TestListDoesNotOfferAShellThatCannotRun(t *testing.T) {
	skipOnWindows(t)
	dir := t.TempDir()
	shellFile(t, dir, "zsh", 0o644) // present, not executable
	real := shellFile(t, dir, "fish", 0o755)
	if got := paths(listIn([]string{dir}, "")); !slices.Equal(got, []string{real}) {
		t.Fatalf("listed %v, want only %v: a file that is not executable is not an installed shell", got, real)
	}
}

func TestListOffersAShellOnceWhateverNumberOfDirectoriesReachIt(t *testing.T) {
	skipOnWindows(t)
	real, link := t.TempDir(), t.TempDir()
	bash := shellFile(t, real, "bash", 0o755)
	if err := os.Symlink(bash, filepath.Join(link, "bash")); err != nil {
		t.Fatal(err)
	}
	other := t.TempDir()
	elsewhere := shellFile(t, other, "bash", 0o755) // a different file of the same name: a different shell
	got := paths(listIn([]string{real, link, other}, ""))
	if want := []string{bash, elsewhere}; !slices.Equal(got, want) {
		t.Fatalf("listed %v, want %v (a link to a shell already listed is not a second shell; another bash is)", got, want)
	}
}

func TestListMarksTheDefaultByTheFileItIs(t *testing.T) {
	skipOnWindows(t)
	dir, link := t.TempDir(), t.TempDir()
	bash := shellFile(t, dir, "bash", 0o755)
	zsh := shellFile(t, dir, "zsh", 0o755)
	if err := os.Symlink(zsh, filepath.Join(link, "login")); err != nil {
		t.Fatal(err)
	}
	for _, asked := range []string{zsh, filepath.Join(link, "login")} {
		var marked []string
		for _, shell := range listIn([]string{dir}, asked) {
			if shell.Default {
				marked = append(marked, shell.Path)
			}
		}
		if !slices.Equal(marked, []string{zsh}) {
			t.Fatalf("with the default %s the marked shells are %v, want exactly [%s] (and never %s)", asked, marked, zsh, bash)
		}
	}
}

func TestListOffersTheDefaultEvenWhereNoStandardDirectoryHoldsIt(t *testing.T) {
	skipOnWindows(t)
	dir, custom := t.TempDir(), t.TempDir()
	bash := shellFile(t, dir, "bash", 0o755)
	nu := shellFile(t, custom, "nu", 0o755)
	got := listIn([]string{dir}, nu)
	if len(got) != 2 {
		t.Fatalf("listed %v, want the default %s and %s", paths(got), nu, bash)
	}
	var marked []Shell
	for _, shell := range got {
		if shell.Default {
			marked = append(marked, shell)
		}
	}
	if len(marked) != 1 || marked[0].Path != nu || marked[0].Name != "nu" {
		t.Fatalf("the default is %+v, want %s named nu", marked, nu)
	}
	// A default that is not there is not invented.
	if got := paths(listIn([]string{dir}, filepath.Join(custom, "missing"))); !slices.Equal(got, []string{bash}) {
		t.Fatalf("listed %v for a default that does not exist, want only %v", got, bash)
	}
}
