package shellenv

import (
	"errors"
	"fmt"
	"io/fs"
	"runtime"
	"slices"
	"strings"
	"testing"
	"unicode/utf8"
)

// The refusal that no shell can start carries every shell it tried as a list, in the order it tried them, as
// tokens: where each path came from and why it did not start. Its sentence is what it always was.
func TestResolveRefusalCarriesEveryAttemptAsTokens(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the order is the Unix one")
	}
	_, _, err := resolve("/ask/zsh", nil, "/env/fish", func() string { return "/acct/fish" }, lookupIn())
	if !errors.Is(err, ErrUnavailable) {
		t.Fatalf("want ErrUnavailable, got %v", err)
	}
	var unavailable *UnavailableError
	if !errors.As(err, &unavailable) {
		t.Fatalf("the refusal does not carry its attempts: %T", err)
	}
	want := []Attempt{
		{Source: SourceRequested, Path: "/ask/zsh", Reason: ReasonNotFound, Detail: ""},
		{Source: SourceEnvironment, Path: "/env/fish", Reason: ReasonNotFound, Detail: ""},
		{Source: SourceAccount, Path: "/acct/fish", Reason: ReasonNotFound, Detail: ""},
		{Source: SourceFallback, Path: "/bin/bash", Reason: ReasonNotFound, Detail: ""},
		{Source: SourceFallback, Path: "/bin/sh", Reason: ReasonNotFound, Detail: ""},
	}
	if !slices.Equal(unavailable.Tried, want) {
		t.Fatalf("attempts: got %v, want %v", unavailable.Tried, want)
	}
	wantText := `shell executable unavailable: tried the shell asked for "/ask/zsh": not found; $SHELL "/env/fish": not found; ` +
		`the account's shell "/acct/fish": not found; the fallback "/bin/bash": not found; the fallback "/bin/sh": not found`
	if got := err.Error(); got != wantText {
		t.Fatalf("the sentence changed:\n got %s\nwant %s", got, wantText)
	}
}

// A path that exists but may not be run is not executable; any other failure is "other" with the system's words.
func TestResolveRefusalSaysWhyEachPathFailedInTokens(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the order is the Unix one")
	}
	lookup := func(name string) (string, error) {
		switch name {
		case "/ask/zsh":
			return "", fmt.Errorf("lookup %s: %w", name, fs.ErrPermission)
		case "/env/fish":
			return "", errors.New("stat /env/fish: input/output error")
		default:
			return "", fmt.Errorf("lookup %s: %w", name, fs.ErrNotExist)
		}
	}
	_, _, err := resolve("/ask/zsh", nil, "/env/fish", noAccount, lookup)
	var unavailable *UnavailableError
	if !errors.As(err, &unavailable) {
		t.Fatalf("want the attempts, got %v", err)
	}
	want := []Attempt{
		{Source: SourceRequested, Path: "/ask/zsh", Reason: ReasonNotExecutable, Detail: ""},
		{Source: SourceEnvironment, Path: "/env/fish", Reason: ReasonOther, Detail: "stat /env/fish: input/output error"},
		{Source: SourceFallback, Path: "/bin/bash", Reason: ReasonNotFound, Detail: ""},
		{Source: SourceFallback, Path: "/bin/sh", Reason: ReasonNotFound, Detail: ""},
	}
	if !slices.Equal(unavailable.Tried, want) {
		t.Fatalf("attempts: got %v, want %v", unavailable.Tried, want)
	}
	for _, words := range []string{`"/ask/zsh": not executable`, `"/env/fish": stat /env/fish: input/output error`} {
		if !strings.Contains(err.Error(), words) {
			t.Fatalf("the sentence lacks %q: %v", words, err)
		}
	}
}

// A shell that exists but is not one the host starts is an attempt too, when it is not the one asked for.
func TestResolveRefusalSaysWhenAFallbackIsNotAShellTheHostStarts(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the order is the Unix one")
	}
	_, _, err := resolve("/ask/zsh", nil, "/bin/cat", noAccount, lookupIn("/bin/cat"))
	var unavailable *UnavailableError
	if !errors.As(err, &unavailable) {
		t.Fatalf("want the attempts, got %v", err)
	}
	if !slices.Contains(unavailable.Tried, Attempt{Source: SourceEnvironment, Path: "/bin/cat", Reason: ReasonNotAShell, Detail: ""}) {
		t.Fatalf("attempts: %v", unavailable.Tried)
	}
	if !strings.Contains(err.Error(), `$SHELL "/bin/cat": not a shell the host starts`) {
		t.Fatalf("the sentence changed: %v", err)
	}
}

// Bound cuts at a character boundary and says so.
func TestBoundKeepsWholeCharacters(t *testing.T) {
	if got := Bound("short", 10); got != "short" {
		t.Fatalf("a short text is kept: %q", got)
	}
	long := strings.Repeat("é", 20)
	got := Bound(long, 9)
	if len(got) > 9 || !utf8.ValidString(got) || !strings.HasSuffix(got, "…") {
		t.Fatalf("got %q (%d bytes)", got, len(got))
	}
}
