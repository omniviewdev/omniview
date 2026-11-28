//go:build !windows

package terminal

import (
	"testing"
	"time"

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

func TestTheQuestionOfWhereTheShellIsIsBoundedInTimeAndInStuckQuestions(t *testing.T) {
	slots := make(chan struct{}, 2)
	gate := make(chan struct{})
	t.Cleanup(func() { close(gate) })
	stuck := func() (string, UnknownReason) { <-gate; return "/never", "" }

	call := func(ask func() (string, UnknownReason)) chan bool {
		done := make(chan bool, 1)
		go func() { _, _, ok := askDirectory(slots, 20*time.Millisecond, ask); done <- ok }()
		return done
	}
	select {
	case ok := <-call(stuck):
		assert.False(t, ok, "a stuck question is not waited for past the budget")
	case <-time.After(10 * time.Second):
		t.Fatal("the call waits for a stuck question")
	}
	assert.Len(t, slots, 1, "the stuck question keeps its slot")
	select {
	case ok := <-call(stuck):
		assert.False(t, ok)
	case <-time.After(10 * time.Second):
		t.Fatal("the call waits for a stuck question")
	}
	// both slots are taken: the next call answers at once, and starts nothing
	started := false
	path, _, ok := askDirectory(slots, time.Hour, func() (string, UnknownReason) { started = true; return "x", "" })
	assert.False(t, ok)
	assert.Empty(t, path)
	assert.False(t, started)
	// the control: a free slot and a quick question
	free := make(chan struct{}, 1)
	path, reason, ok := askDirectory(free, time.Second, func() (string, UnknownReason) { return "/here", "" })
	assert.True(t, ok)
	assert.Equal(t, "/here", path)
	assert.Empty(t, reason)
	assert.Empty(t, free, "the slot is given back")
}
