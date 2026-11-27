package extensionpolicy

import (
	"testing"

	"github.com/stretchr/testify/require"
	"golang.org/x/sys/windows"
)

func TestPolicyWatchRejectsExposedWindowsDACL(t *testing.T) {
	watchPermissionChange(t, func(path string) {
		user, err := windows.GetCurrentProcessToken().GetTokenUser()
		require.NoError(t, err)
		sd, err := windows.SecurityDescriptorFromString("D:P(A;;FA;;;" + user.User.Sid.String() + ")(A;;FR;;;WD)")
		require.NoError(t, err)
		dacl, _, err := sd.DACL()
		require.NoError(t, err)
		require.NoError(t, windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil))
	})
}
