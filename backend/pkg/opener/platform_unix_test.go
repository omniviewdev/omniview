//go:build linux

package opener

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The address reaches the platform's program as one element of an argument array: a program of the test's own stands where xdg-open does and writes what
// it was given. Characters a shell reads (`&`, quotes, parentheses, `*`, `~`) arrive whole, which a command line through a shell would not do.
func TestTheAddressIsOneArgumentOfTheProgramAndNoShellReadsIt(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "args")
	script := "#!/bin/sh\nprintf '%s\\n' \"$#\" \"$@\" > \"${0%/*}/args.tmp\" && mv \"${0%/*}/args.tmp\" \"${0%/*}/args\"\n"
	require.NoError(t, os.WriteFile(filepath.Join(dir, "xdg-open"), []byte(script), 0o755))
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))

	target := "https://example.com/p?a=1&b=2&c='x'(y)*~!&touch&pwned"
	got, err := New().OpenExternalURL(target)
	require.NoError(t, err)
	assert.Equal(t, Result{Opened: true}, got)
	require.Eventually(t, func() bool { _, statErr := os.Stat(out); return statErr == nil }, 30e9, 2e6, "the program ran")
	raw, err := os.ReadFile(out)
	require.NoError(t, err)
	assert.Equal(t, "1\n"+target+"\n", string(raw), "one argument, whole")
	_, statErr := os.Stat(filepath.Join(dir, "pwned"))
	require.Error(t, statErr)
	assert.NotContains(t, string(raw), "sh -c")
}

// The control: the program is the one the platform names, and a program that does not exist is a failure that holds no address.
func TestAMissingPlatformProgramIsAFailureWithoutTheAddress(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	_, err := New().OpenExternalURL("https://a.example/s3cr3t")
	require.Error(t, err)
	assert.NotContains(t, err.Error(), "s3cr3t")
}
