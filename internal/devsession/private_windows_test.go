//go:build windows

package devsession

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
)

func TestDiscoveryRejectsTokenReadableByAnotherWindowsPrincipal(t *testing.T) {
	store, err := OpenDiscoveryStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	discovery, err := store.Publish(context.Background(), fixtureDescriptor(t, "windows-acl"), []byte("fixture-token-012345678901234567890123456789"))
	if err != nil {
		t.Fatal(err)
	}
	sid, err := currentUserSID()
	if err != nil {
		t.Fatal(err)
	}
	sd, err := windows.SecurityDescriptorFromString("D:P(A;;FA;;;" + sid.String() + ")(A;;FR;;;WD)")
	if err != nil {
		t.Fatal(err)
	}
	dacl, _, err := sd.DACL()
	if err != nil {
		t.Fatal(err)
	}
	if err := windows.SetNamedSecurityInfo(discovery.TokenFile, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Read(context.Background(), fixtureWorkspace, discovery.Generation); !errors.Is(err, ErrOwnership) {
		t.Fatalf("publicly readable token accepted: %v", err)
	}
}

func TestPrivateMetadataRejectsAdditionalWindowsPrincipalWithoutMutation(t *testing.T) {
	root, err := EnsurePrivateDirectory(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "ledger.json")
	if err := WritePrivateJSON(path, metadataFixture{WorkspaceID: fixtureWorkspace, Generation: "private"}); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	sid, err := currentUserSID()
	if err != nil {
		t.Fatal(err)
	}
	sd, err := windows.SecurityDescriptorFromString("D:P(A;;FA;;;" + sid.String() + ")(A;;FR;;;WD)")
	if err != nil {
		t.Fatal(err)
	}
	dacl, _, err := sd.DACL()
	if err != nil {
		t.Fatal(err)
	}
	if err := windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil); err != nil {
		t.Fatal(err)
	}
	if err := ValidatePrivateFile(path); !errors.Is(err, ErrOwnership) {
		t.Fatalf("extra principal accepted: %v", err)
	}
	var value metadataFixture
	if err := ReadPrivateJSON(path, &value); !errors.Is(err, ErrOwnership) {
		t.Fatalf("public metadata read accepted: %v", err)
	}
	if err := WritePrivateJSON(path, metadataFixture{WorkspaceID: secondWorkspace, Generation: "replacement"}); !errors.Is(err, ErrOwnership) {
		t.Fatalf("public metadata write accepted: %v", err)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("rejected metadata was mutated: %v", err)
	}
}
