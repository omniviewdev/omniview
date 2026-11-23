package shellenv

import (
	"errors"
	"fmt"
	"io/fs"
	"runtime"
	"slices"
	"strings"
	"testing"
)

// lookupIn is a lookup that finds only the shells that are installed.
func lookupIn(installed ...string) func(string) (string, error) {
	return func(name string) (string, error) {
		if slices.Contains(installed, name) {
			return name, nil
		}
		return "", fmt.Errorf("lookup %s: %w", name, fs.ErrNotExist)
	}
}

func noAccount() string { return "" }

func TestResolveTriesTheCallersShellThenTheEnvironmentThenTheAccountThenBashThenSh(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the order is the Unix one")
	}
	account := func() string { return "/acct/fish" }
	order := []string{"/ask/zsh", "/env/fish", "/acct/fish", "/bin/bash", "/bin/sh"}
	for i, want := range order {
		path, args, err := resolve("/ask/zsh", []string{"-c", "true"}, "/env/fish", account, lookupIn(order[i:]...))
		if err != nil {
			t.Fatalf("with %v installed: %v", order[i:], err)
		}
		if path != want {
			t.Fatalf("with %v installed the shell is %s, want %s", order[i:], path, want)
		}
		wantArgs := []string{"-i", "-l"}
		if i == 0 {
			wantArgs = []string{"-i", "-l", "-c", "true"}
		}
		if !slices.Equal(args, wantArgs) {
			t.Fatalf("arguments of %s: got %v, want %v (the caller's arguments go with the shell it asked for only)", path, args, wantArgs)
		}
	}
}

func TestResolveRefusesWithEveryPathItTriedWhenNoShellStarts(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the order is the Unix one")
	}
	_, _, err := resolve("/ask/zsh", nil, "/env/fish", func() string { return "/acct/fish" }, lookupIn())
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("want ErrUnavailable, got %v", err)
	}
	for _, path := range []string{"/ask/zsh", "/env/fish", "/acct/fish", "/bin/bash", "/bin/sh"} {
		if !strings.Contains(err.Error(), path) {
			t.Fatalf("the refusal does not name %s: %v", path, err)
		}
	}
}

func TestResolveRefusesAProgramThatIsNotAShellAndDoesNotReplaceIt(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the order is the Unix one")
	}
	_, _, err := resolve("/bin/cat", nil, "", noAccount, lookupIn("/bin/cat", "/bin/bash"))
	if !errors.Is(err, ErrUnsupported) {
		t.Fatalf("a program that is not a shell must be refused, not replaced by bash: %v", err)
	}
}

func TestResolveSkipsAnEnvironmentShellThatIsNotAShell(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the order is the Unix one")
	}
	path, _, err := resolve("", nil, "/usr/bin/python3", noAccount, lookupIn("/usr/bin/python3", "/bin/bash"))
	if err != nil || path != "/bin/bash" {
		t.Fatalf("$SHELL naming a program that is not a shell is skipped: path=%s err=%v", path, err)
	}
}

func TestResolveAsksTheAccountOnlyWhenTheShellsBeforeItDidNotStart(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the order is the Unix one")
	}
	account := func() string {
		t.Fatal("asked the account although a shell started")
		return ""
	}
	if _, _, err := resolve("/ask/zsh", nil, "/env/fish", account, lookupIn("/env/fish")); err != nil {
		t.Fatal(err)
	}
}

func TestCheckIsStrict(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Unix shell executable fixture")
	}
	if _, err := Check("/missing/shell"); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("a missing shell must be refused, not replaced: %v", err)
	}
	if _, err := Check("/bin/cat"); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("a program that is not a shell must be refused: %v", err)
	}
}

func TestAFailedProbeIsRecordedAndNeverSwallowed(t *testing.T) {
	state.mu.Lock()
	saved := state.probe
	state.mu.Unlock()
	t.Cleanup(func() {
		state.mu.Lock()
		state.probe = saved
		state.mu.Unlock()
	})

	recordProbe(errors.New("login environment resolution failed or timed out"))
	failed := Probe()
	if failed.State != ProbeFailed || failed.Message != "login environment resolution failed or timed out" {
		t.Fatalf("a failed probe is recorded with its reason: %+v", failed)
	}
	recordProbe(nil)
	if succeeded := Probe(); succeeded.State != ProbeOK || succeeded.Message != "" {
		t.Fatalf("a probe that worked is recorded as ok: %+v", succeeded)
	}
}

func TestTheLaunchEnvironmentIsTheFirstOneRememberedAndIsACopy(t *testing.T) {
	state.mu.Lock()
	saved := state.environment
	state.environment = nil
	state.mu.Unlock()
	t.Cleanup(func() {
		state.mu.Lock()
		state.environment = saved
		state.mu.Unlock()
	})

	remember([]string{"A=1"})
	remember([]string{"A=2"})
	first := LaunchEnvironment()
	if !slices.Equal(first, []string{"A=1"}) {
		t.Fatalf("the launch environment is the first one remembered: %v", first)
	}
	first[0] = "A=3"
	if again := LaunchEnvironment(); again[0] != "A=1" {
		t.Fatal("a caller changed the recorded environment")
	}
}
