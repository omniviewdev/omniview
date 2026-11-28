//go:build !windows

package terminal

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestOnlyADirectoryTheShellProvedOrIsInIsVouchedFor(t *testing.T) {
	record := Commands{
		Cwd: "/work/now", CwdTrust: "nonce",
		Commands: []Command{
			{ID: "1", Cwd: "/work/old", CwdTrust: "nonce"},
			{ID: "2", Cwd: "/printed/by/a/program", CwdTrust: "unverified"},
			{ID: "3", Cwd: "", CwdTrust: "nonce"},
		},
	}
	for dir, want := range map[string]bool{
		"/work/now":             true,  // proved
		"/work/old/":            true,  // a command's, with the nonce; a trailing slash is the same directory
		"/work/./old":           true,  // as is a dotted spelling
		"/system/says":          true,  // the shell is in it now
		"/printed/by/a/program": false, // anything could have printed it
		"/etc":                  false,
		"":                      false,
		"work/old":              false, // relative
		"/work/old/..":          false, // cleans to /work, which nothing proved
	} {
		assert.Equal(t, want, vouches(record, "/system/says", dir), "%q", dir)
	}
	assert.False(t, vouches(record, "", "/system/says"), "an unknown directory of the shell vouches for nothing")
	assert.False(t, vouches(Commands{Cwd: "/work/now", CwdTrust: "unverified"}, "", "/work/now"), "a directory without the nonce is not proved")
}
