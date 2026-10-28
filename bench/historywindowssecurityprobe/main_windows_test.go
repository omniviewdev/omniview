//go:build windows

package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"testing"

	"golang.org/x/sys/windows"
)

func TestAllowedACE(t *testing.T) {
	user := "S-1-5-21-123-456-789-1001"
	for _, tc := range []struct {
		name        string
		kind, flags uint8
		mask        uint32
		sid         string
		want        bool
	}{
		{"owner", 0, 0, 0x1f01ff, user, true},
		{"system", 0, 0, 0x1f01ff, "S-1-5-18", true},
		{"everyone", 0, 0, 0x1f01ff, "S-1-1-0", false},
		{"administrators", 0, 0, 0x1f01ff, "S-1-5-32-544", false},
		{"inherited_private_owner", 0, 0x10, 0x1f01ff, user, true},
		{"inherit_private_children", 0, 3, 0x1f01ff, user, true},
		{"inherited_everyone", 0, 0x10, 0x1f01ff, "S-1-1-0", false},
		{"inherit_everyone", 0, 3, 0x1f01ff, "S-1-1-0", false},
		{"unexpected_flags", 0, 8, 0x1f01ff, user, false},
		{"deny", 1, 0, 0x1f01ff, user, false},
		{"partial_rights", 0, 0, 0x120089, user, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := allowedACE(tc.kind, tc.flags, tc.mask, tc.sid, user) == nil; got != tc.want {
				t.Fatalf("accepted=%v want=%v", got, tc.want)
			}
		})
	}
}

func TestRejectInvalidKeyBeforeVaultWrite(t *testing.T) {
	for _, size := range []int{0, 1, 31, 33} {
		if err := put("Omniview-HR02-Proof/invalid-key-boundary", make([]byte, size)); err == nil {
			t.Fatalf("accepted size %d", size)
		}
	}
	if _, err := get("invalid\x00target"); err == nil {
		t.Fatal("accepted embedded NUL")
	}
}

func TestConsumeCredentialClearsBlobBuffer(t *testing.T) {
	for _, tc := range []struct {
		name  string
		kind  uint32
		size  int
		valid bool
	}{
		{"valid", 1, 32, true},
		{"wrong_length", 1, 31, false},
		{"wrong_type", 2, 32, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			native := bytes.Repeat([]byte{0xa5}, tc.size)
			c := credential{Type: tc.kind, BlobSize: uint32(len(native)), Blob: &native[0]}
			got, err := consumeCredential(&c)
			defer wipe(got)
			if (err == nil) != tc.valid {
				t.Fatal("unexpected key shape result")
			}
			if !bytes.Equal(native, make([]byte, len(native))) {
				t.Fatal("native credential buffer was not cleared before release")
			}
			if tc.valid && !bytes.Equal(got, bytes.Repeat([]byte{0xa5}, 32)) {
				t.Fatal("returned key was not independently cloned")
			}
		})
	}
}

func TestNativeExistingCredentialRemainsUnchanged(t *testing.T) {
	nonce := make([]byte, 16)
	key := make([]byte, 32)
	defer wipe(key)
	if _, err := rand.Read(nonce); err != nil {
		t.Fatal(err)
	}
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	target := "Omniview-HR02-Proof/test-" + hex.EncodeToString(nonce)
	if err := requireAbsent(target); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := remove(target); err != nil && !errors.Is(err, windows.ERROR_NOT_FOUND) {
			t.Error("owned credential cleanup failed")
		}
	})
	if err := put(target, key); err != nil {
		t.Fatal(err)
	}
	if err := requireAbsent(target); err == nil {
		t.Fatal("existing credential accepted as fresh")
	}
	got, err := get(target)
	defer wipe(got)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, key) {
		t.Fatal("freshness rejection changed existing credential")
	}
}
