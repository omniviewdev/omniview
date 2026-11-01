//go:build windows

package resource

import (
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"golang.org/x/sys/windows"
)

func TestProfileCredentialsWindowsRejectBroadenedDACL(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "plugin", connectionOverlayTestProvider())
	connection := profileTestConnection("registry", "https://registry.example")
	token := "private-token-marker"
	_, err := ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", connection, &ConnectionProfileCredentials{Token: &token})
	require.NoError(t, err)
	root, err := ctrl.pluginStoreFn("plugin")
	require.NoError(t, err)
	stored, err := readDesiredConnections(root)
	require.NoError(t, err)
	file, err := root.OpenFile(profileCredentialPrefix+stored.Profiles[0].CredentialsRef, os.O_RDONLY, 0)
	require.NoError(t, err)
	defer file.Close()
	require.NoError(t, validateProfileCredentialFile(file))
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	require.NoError(t, err)
	public, err := windows.SecurityDescriptorFromString("D:P(A;;FA;;;" + user.User.Sid.String() + ")(A;;FR;;;WD)")
	require.NoError(t, err)
	dacl, _, err := public.DACL()
	require.NoError(t, err)
	handle, _, callErr := reopenProfileFile.Call(file.Fd(), uintptr(windows.WRITE_DAC), uintptr(windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE), 0)
	if windows.Handle(handle) == windows.InvalidHandle {
		t.Fatal(callErr)
	}
	defer windows.CloseHandle(windows.Handle(handle))
	require.NoError(t, windows.SetSecurityInfo(windows.Handle(handle), windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil))
	require.Error(t, validateProfileCredentialFile(file))
	_, err = readDesiredConnections(root)
	require.ErrorContains(t, err, "permissions are unsafe")
	_, err = ctrl.ListConnectionProfiles(testInvocationContext(), "plugin")
	require.Error(t, err)
	require.NotContains(t, err.Error(), token)
}

func TestProfileCredentialsWindowsRejectBroadParentBeforeCreation(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	registerMockPlugin(ctrl, "plugin", connectionOverlayTestProvider())
	root, err := ctrl.pluginStoreFn("plugin")
	require.NoError(t, err)
	path := root.ResolvePath("")
	original, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
	require.NoError(t, err)
	t.Cleanup(func() {
		dacl, _, err := original.DACL()
		if err == nil {
			_ = windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil)
		}
	})
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	require.NoError(t, err)
	public, err := windows.SecurityDescriptorFromString("D:P(A;OICI;FA;;;" + user.User.Sid.String() + ")(A;OICI;FR;;;WD)")
	require.NoError(t, err)
	dacl, _, err := public.DACL()
	require.NoError(t, err)
	require.NoError(t, windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil))
	token := "must-never-reach-disk"
	_, err = ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", profileTestConnection("registry", "endpoint"), &ConnectionProfileCredentials{Token: &token})
	require.ErrorContains(t, err, "directory permissions are unsafe")
	entries, err := root.ReadDir(".")
	require.NoError(t, err)
	for _, entry := range entries {
		require.False(t, strings.HasPrefix(entry.Name(), profileCredentialPrefix), "must refuse before creating any private file")
	}
}
