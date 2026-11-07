package devoutputs

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/omniviewdev/omniview/internal/devsession"
	"golang.org/x/sys/windows"
)

func TestPrivateOutputCreationDoesNotRepairExistingWindowsACL(t *testing.T) {
	root := privateOutputFixtureDirectory(t)
	parentIdentity, err := directoryIdentity(root)
	if err != nil {
		t.Fatal(err)
	}
	path, err := devsession.EnsurePrivateDirectory(filepath.Join(root, "existing"))
	if err != nil {
		t.Fatal(err)
	}
	writeOutput(t, filepath.Join(path, "retained"), "unknown bytes")
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		t.Fatal(err)
	}
	descriptor, err := windows.SecurityDescriptorFromString("D:P(A;;FA;;;" + user.User.Sid.String() + ")(A;;FR;;;WD)")
	if err != nil {
		t.Fatal(err)
	}
	dacl, _, err := descriptor.DACL()
	if err != nil {
		t.Fatal(err)
	}
	if err = windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil); err != nil {
		t.Fatal(err)
	}
	if err = devsession.ValidatePrivateDirectory(path); !errors.Is(err, devsession.ErrOwnership) {
		t.Fatalf("fixture did not expose an additional principal: %v", err)
	}
	before, err := observeSnapshotPath(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = createPrivateOutputDirectory(path, parentIdentity); !os.IsExist(err) {
		t.Fatalf("existing root was not refused: %v", err)
	}
	if err = devsession.ValidatePrivateDirectory(path); !errors.Is(err, devsession.ErrOwnership) {
		t.Fatalf("refusal repaired an unowned ACL: %v", err)
	}
	after, err := observeSnapshotPath(path)
	if err != nil || !os.SameFile(before, after) {
		t.Fatal("existing root identity changed", err)
	}
	raw, err := os.ReadFile(filepath.Join(path, "retained"))
	if err != nil || string(raw) != "unknown bytes" {
		t.Fatal("unknown bytes changed", err)
	}
}
