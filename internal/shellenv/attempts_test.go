package shellenv

import (
	"errors"
	"runtime"
	"slices"
	"testing"
)

// The refusal that no shell can start carries every shell it tried as a list, in the order it tried them, with
// where each path came from and why it did not start; its sentence is what it always was.
func TestResolveRefusalCarriesEveryAttemptAsAList(t *testing.T) {
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
		{Source: "the shell asked for", Path: "/ask/zsh", Reason: "not found"},
		{Source: "$SHELL", Path: "/env/fish", Reason: "not found"},
		{Source: "the account's shell", Path: "/acct/fish", Reason: "not found"},
		{Source: "the fallback", Path: "/bin/bash", Reason: "not found"},
		{Source: "the fallback", Path: "/bin/sh", Reason: "not found"},
	}
	if !slices.Equal(unavailable.Tried, want) {
		t.Fatalf("attempts: got %v, want %v", unavailable.Tried, want)
	}
	if got, wantText := err.Error(), `shell executable unavailable: tried the shell asked for "/ask/zsh": not found; $SHELL "/env/fish": not found; the account's shell "/acct/fish": not found; the fallback "/bin/bash": not found; the fallback "/bin/sh": not found`; got != wantText {
		t.Fatalf("the sentence changed:\n got %s\nwant %s", got, wantText)
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
	if !slices.Contains(unavailable.Tried, Attempt{Source: "$SHELL", Path: "/bin/cat", Reason: "not a shell the host starts"}) {
		t.Fatalf("attempts: %v", unavailable.Tried)
	}
}
