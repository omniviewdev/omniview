//go:build windows

package main

import "testing"

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
		{"inherited", 0, 0x10, 0x1f01ff, user, false},
		{"inherit_children", 0, 3, 0x1f01ff, user, false},
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
