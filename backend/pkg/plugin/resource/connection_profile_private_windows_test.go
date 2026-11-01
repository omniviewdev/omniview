//go:build windows

package resource

import (
	"context"
	"os"
	"strings"
	"testing"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
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
	handle, _, callErr := reopenProfileFile.Call(file.Fd(), uintptr(windows.WRITE_DAC|windows.SYNCHRONIZE), uintptr(windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE|windows.FILE_SHARE_DELETE), 0)
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
	require.Error(t, err)
	entries, err := root.ReadDir(".")
	require.NoError(t, err)
	for _, entry := range entries {
		require.False(t, strings.HasPrefix(entry.Name(), profileCredentialPrefix), "must refuse before creating any private file")
	}
}

func TestProfileCredentialsWindowsRestrictNativeHandleBeforeWrite(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	root, err := ctrl.pluginStoreFn("native-acl")
	require.NoError(t, err)
	file, err := root.OpenFile("native-acl-probe", os.O_CREATE|os.O_EXCL|os.O_RDWR, 0o600)
	require.NoError(t, err)
	defer file.Close()
	// Call the native helper directly: Win32 failures must remain diagnosable
	// here, while the consumer API keeps sanitized credential errors.
	if err := restrictProfileCredentialFile(file); err != nil {
		t.Fatalf("restrict native credential handle: %v", err)
	}
	require.NoError(t, validateProfileCredentialFile(file))
	_, err = file.WriteString("non-secret-native-acl-probe")
	require.NoError(t, err)
	require.NoError(t, file.Sync())
	require.NoError(t, file.Close())
	reopened, err := openProfileCredentialFile(root, "native-acl-probe")
	require.NoError(t, err)
	defer reopened.Close()
	require.NoError(t, validateProfileCredentialFile(reopened))
}

func TestProfileCredentialsWindowsReplayRejectsBroadenedPublicStorage(t *testing.T) {
	for _, target := range []string{"directory", "public-profile"} {
		t.Run(target, func(t *testing.T) {
			ctrl, _ := newTestControllerWithEmitter(t)
			connection := profileTestConnection("registry", "trusted-endpoint")
			registerMockPlugin(ctrl, "plugin", connectionOverlayTestProvider(connection))
			token := "protected-private-marker"
			_, err := ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", connection, &ConnectionProfileCredentials{Token: &token})
			require.NoError(t, err)
			root, err := ctrl.pluginStoreFn("plugin")
			require.NoError(t, err)
			state, err := readDesiredConnections(root)
			require.NoError(t, err)
			private, err := openProfileCredentialFile(root, profileCredentialPrefix+state.Profiles[0].CredentialsRef)
			require.NoError(t, err)
			require.NoError(t, validateProfileCredentialFile(private))
			require.NoError(t, private.Close())
			path := root.ResolvePath("")
			flags := "OICI"
			if target == "public-profile" {
				path = root.ResolvePath(connectionProfileStoreName)
				flags = ""
			}
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
			public, err := windows.SecurityDescriptorFromString("D:P(A;" + flags + ";FA;;;" + user.User.Sid.String() + ")(A;" + flags + ";FR;;;WD)")
			require.NoError(t, err)
			dacl, _, err := public.DACL()
			require.NoError(t, err)
			require.NoError(t, windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, dacl, nil))
			restarted, _ := newTestControllerWithEmitter(t)
			restarted.pluginStoreFn = ctrl.pluginStoreFn
			provider := connectionOverlayTestProvider(connection)
			applies := 0
			provider.ApplyConnectionOverlayFunc = func(ctx context.Context, overlay resourcev2.ConnectionOverlay) error {
				applies++
				return provider.applyConnectionOverlay(ctx, overlay)
			}
			registerMockPlugin(restarted, "plugin", provider)
			effective, err := restarted.replayConnectionProfiles(testInvocationContext(), "plugin", []types.Connection{connection})
			require.Error(t, err)
			require.NotContains(t, err.Error(), token)
			require.Empty(t, effective)
			require.Zero(t, applies)
			require.Empty(t, restarted.getConnections("plugin"))
		})
	}
}
