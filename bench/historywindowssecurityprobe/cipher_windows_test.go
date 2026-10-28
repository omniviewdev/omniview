//go:build windows && cgo

package main

import (
	"bytes"
	"encoding/hex"
	"net/url"
	"testing"
)

func TestCipherURIAdmitsDrivePathAndKeyBeforeDriverInitialization(t *testing.T) {
	key := bytes.Repeat([]byte{0xa5}, 32)
	uri, err := url.Parse(cipherURI(`C:\private space\history.db`, key))
	if err != nil {
		t.Fatal("URI parse failed")
	}
	if uri.Scheme != "file" || uri.Path != "/C:/private space/history.db" {
		t.Fatal("Windows file URI path changed")
	}
	if uri.Query().Get("key") != "x'"+hex.EncodeToString(key)+"'" {
		t.Fatal("URI key admission changed")
	}
	if uri.RawPath != "" {
		t.Fatal("unexpected alternate path")
	}
	empty, err := url.Parse(cipherURI(`C:\private\history.db`, nil))
	if err != nil {
		t.Fatal("keyless URI parse failed")
	}
	if empty.RawQuery != "" {
		t.Fatal("absent key was synthesized")
	}
}
