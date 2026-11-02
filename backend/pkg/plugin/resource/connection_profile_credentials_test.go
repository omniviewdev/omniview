package resource

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"runtime"
	"strings"
	"testing"

	"github.com/omniviewdev/omniview/internal/appstate"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
	"github.com/stretchr/testify/require"
)

func TestProfileCredentialsPrivatePersistenceEditReloadClearRemove(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := connectionOverlayTestProvider()
	registerMockPlugin(ctrl, "plugin", provider)
	connection := profileTestConnection("registry", "https://registry.example")
	connection.UID = "incarnation-one"
	username, token := "private-user-marker", "private-token-marker"
	result, err := ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", connection, &ConnectionProfileCredentials{Username: &username, Token: &token})
	require.NoError(t, err)
	require.Nil(t, result.Profile.Connection.GetSensitiveData())
	response, err := json.Marshal(result)
	require.NoError(t, err)
	require.NotContains(t, string(response), username)
	require.NotContains(t, string(response), token)
	root, err := ctrl.pluginStoreFn("plugin")
	require.NoError(t, err)
	public, err := root.ReadFile(connectionProfileStoreName)
	require.NoError(t, err)
	require.NotContains(t, string(public), username)
	require.NotContains(t, string(public), token)
	stored, err := readDesiredConnections(root)
	require.NoError(t, err)
	ref := stored.Profiles[0].CredentialsRef
	private, err := root.ReadFile(profileCredentialPrefix + ref)
	require.NoError(t, err)
	require.Contains(t, string(private), token)
	info, err := root.Stat(profileCredentialPrefix + ref)
	require.NoError(t, err)
	if runtime.GOOS != "windows" {
		require.Equal(t, os.FileMode(0o600), info.Mode().Perm())
	}

	connection.Name = "Display-only change"
	_, err = ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", connection, nil)
	require.NoError(t, err)
	stored, err = readDesiredConnections(root)
	require.NoError(t, err)
	require.Equal(t, ref, stored.Profiles[0].CredentialsRef)
	require.Equal(t, token, stored.overlay().Upserts[0].GetSensitiveData()["token"])

	// A new provider generation consumes credentials reconstructed from private
	// disk storage, never a value returned by the public profile API.
	restarted := connectionOverlayTestProvider()
	registerMockPlugin(ctrl, "plugin", restarted)
	effective, err := ctrl.replayConnectionProfiles(testInvocationContext(), "plugin", nil)
	require.NoError(t, err)
	require.Equal(t, username, effective[0].GetSensitiveData()["username"])
	require.Equal(t, token, effective[0].GetSensitiveData()["token"])
	listed, err := ctrl.ListConnectionProfiles(testInvocationContext(), "plugin")
	require.NoError(t, err)
	require.Nil(t, listed[0].Connection.GetSensitiveData())
	response, err = json.Marshal(listed)
	require.NoError(t, err)
	require.NotContains(t, string(response), token)

	empty := ""
	_, err = ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", connection, &ConnectionProfileCredentials{Token: &empty})
	require.NoError(t, err)
	stored, err = readDesiredConnections(root)
	require.NoError(t, err)
	require.Equal(t, username, stored.overlay().Upserts[0].GetSensitiveData()["username"])
	require.NotContains(t, stored.overlay().Upserts[0].GetSensitiveData(), "token")
	_, err = root.Stat(profileCredentialPrefix + ref)
	require.True(t, os.IsNotExist(err), "replaced private file must be removed")
	ref = stored.Profiles[0].CredentialsRef
	require.NoError(t, ctrl.RemoveConnection(testInvocationContext(), "plugin", connection.ID))
	_, err = root.Stat(profileCredentialPrefix + ref)
	require.True(t, os.IsNotExist(err), "removed profile must not retain its private file")
	_, err = ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", connection, nil)
	require.NoError(t, err)
	stored, err = readDesiredConnections(root)
	require.NoError(t, err)
	require.Empty(t, stored.Profiles[0].CredentialsRef, "ID reuse must not recover removed credentials")
}

func TestProfileCredentialsNeverFollowChangedEndpointOrIncarnation(t *testing.T) {
	for _, change := range []string{"endpoint", "uid", "type"} {
		t.Run(change, func(t *testing.T) {
			ctrl, _ := newTestControllerWithEmitter(t)
			provider := connectionOverlayTestProvider()
			registerMockPlugin(ctrl, "plugin", provider)
			connection := profileTestConnection("same-route", "trusted.example")
			connection.UID = "first-incarnation"
			secret := "must-not-follow-new-target"
			_, err := ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", connection, &ConnectionProfileCredentials{Token: &secret})
			require.NoError(t, err)
			root, err := ctrl.pluginStoreFn("plugin")
			require.NoError(t, err)
			old, err := readDesiredConnections(root)
			require.NoError(t, err)
			switch change {
			case "endpoint":
				connection.Data = map[string]any{"endpoint": "untrusted.example"}
			case "uid":
				connection.UID = "second-incarnation"
			case "type":
				connection.Data = map[string]any{"endpoint": "trusted.example", "type": "other-backend"}
			}
			_, err = ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", connection, nil)
			require.NoError(t, err)
			stored, err := readDesiredConnections(root)
			require.NoError(t, err)
			require.Empty(t, stored.Profiles[0].CredentialsRef)
			effective, err := provider.ListConnections(context.Background())
			require.NoError(t, err)
			require.Empty(t, effective[0].GetSensitiveData(), "changed target must receive no previous credentials")
			_, err = root.Stat(profileCredentialPrefix + old.Profiles[0].CredentialsRef)
			require.True(t, os.IsNotExist(err))
		})
	}
}

func TestProfileCredentialExplicitEmptySurvivesReloadAndReset(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	native := profileTestConnection("native", "endpoint")
	native.UID = "native-incarnation"
	provider := connectionOverlayTestProvider(native)
	registerMockPlugin(ctrl, "plugin", provider)
	empty := ""
	_, err := ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", native, &ConnectionProfileCredentials{Username: &empty, Token: &empty})
	require.NoError(t, err)
	root, err := ctrl.pluginStoreFn("plugin")
	require.NoError(t, err)
	state, err := readDesiredConnections(root)
	require.NoError(t, err)
	require.NotNil(t, state.overlay().Upserts[0].GetSensitiveData(), "empty private map prevents SDK native-secret inheritance")
	require.Empty(t, state.overlay().Upserts[0].GetSensitiveData())
	ref := state.Profiles[0].CredentialsRef
	_, err = ctrl.ResetConnectionProfile(testInvocationContext(), "plugin", native.ID)
	require.NoError(t, err)
	_, err = root.Stat(profileCredentialPrefix + ref)
	require.True(t, os.IsNotExist(err))
	state, err = readDesiredConnections(root)
	require.NoError(t, err)
	require.Empty(t, state.Profiles)
}

func TestProfileCredentialCleanupFailurePublishesCommittedConnections(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := connectionOverlayTestProvider()
	registerMockPlugin(ctrl, "plugin", provider)
	connection := profileTestConnection("route", "endpoint")
	oldToken, newToken := "old-token", "new-token"
	_, err := ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", connection, &ConnectionProfileCredentials{Token: &oldToken})
	require.NoError(t, err)
	root, err := ctrl.pluginStoreFn("plugin")
	require.NoError(t, err)
	before, err := readDesiredConnections(root)
	require.NoError(t, err)
	oldName := profileCredentialPrefix + before.Profiles[0].CredentialsRef
	provider.ApplyConnectionOverlayFunc = func(ctx context.Context, overlay resourcev2.ConnectionOverlay) error {
		if err := provider.applyConnectionOverlay(ctx, overlay); err != nil {
			return err
		}
		require.NoError(t, root.Remove(oldName))
		require.NoError(t, root.MkdirAll(oldName, 0o700))
		require.NoError(t, root.WriteFile(oldName+"/blocker", []byte("cleanup blocker"), 0o600))
		return nil
	}
	connection.Name = "committed display name"
	_, err = ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", connection, &ConnectionProfileCredentials{Token: &newToken})
	require.Equal(t, "RESET_REQUIRED", resourcev2.ErrorCode(err))
	stored, err := readDesiredConnections(root)
	require.NoError(t, err)
	require.Equal(t, connection.Name, stored.Profiles[0].Configuration.Name)
	profiles, err := ctrl.ListConnectionProfiles(testInvocationContext(), "plugin")
	require.NoError(t, err)
	require.True(t, profiles[0].Active, "committed effective profile must remain active despite obsolete-credential cleanup failure")
	require.Equal(t, connection.Name, profiles[0].Connection.Name, "public inventory must reflect the committed source despite cleanup failure")
}

func TestProfileCredentialRejectedSaveRetainsOnlyCommittedPrivateFile(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := connectionOverlayTestProvider()
	registerMockPlugin(ctrl, "plugin", provider)
	connection := profileTestConnection("route", "endpoint")
	oldToken, newToken := "committed-token", "rejected-token"
	_, err := ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", connection, &ConnectionProfileCredentials{Token: &oldToken})
	require.NoError(t, err)
	root, err := ctrl.pluginStoreFn("plugin")
	require.NoError(t, err)
	before, err := root.ReadFile(connectionProfileStoreName)
	require.NoError(t, err)
	provider.ApplyConnectionOverlayFunc = func(context.Context, resourcev2.ConnectionOverlay) error {
		return errors.New("provider rejected configuration")
	}
	_, err = ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", connection, &ConnectionProfileCredentials{Token: &newToken})
	require.Error(t, err)
	after, err := root.ReadFile(connectionProfileStoreName)
	require.NoError(t, err)
	require.Equal(t, before, after)
	entries, err := root.ReadDir(".")
	require.NoError(t, err)
	privateCount := 0
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), profileCredentialPrefix) {
			privateCount++
			data, err := root.ReadFile(entry.Name())
			require.NoError(t, err)
			require.NotContains(t, string(data), newToken)
		}
	}
	require.Equal(t, 1, privateCount)
}

func TestProfileCredentialStoreRejectsWrongOwnerPermissionsAndBounds(t *testing.T) {
	for _, mutation := range []string{"uid", "id", "permissions", "oversize", "unknown-key"} {
		t.Run(mutation, func(t *testing.T) {
			if mutation == "permissions" && runtime.GOOS == "windows" {
				t.Skip("Windows ACL rejection has native platform coverage")
			}
			root, err := appstate.NewTestService(t).PluginStore("test")
			require.NoError(t, err)
			connection := profileTestConnection("route", "endpoint")
			connection.UID = "incarnation"
			token := "secret"
			profile, err := prepareProfileCredentials(root, emptyDesiredConnections(), "manual", connection, &ConnectionProfileCredentials{Token: &token})
			require.NoError(t, err)
			state := emptyDesiredConnections()
			state.Profiles = append(state.Profiles, profile)
			data, err := encodeDesiredConnections(state)
			require.NoError(t, err)
			require.NoError(t, writeDesiredConnections(root, data))
			name := profileCredentialPrefix + profile.CredentialsRef
			digest, err := profileCredentialDataDigest(profile.Configuration)
			require.NoError(t, err)
			stored := storedProfileCredentials{ID: connection.ID, UID: connection.UID, DataDigest: digest, Values: map[string]string{"token": token}}
			switch mutation {
			case "uid":
				stored.UID = "different-incarnation"
			case "id":
				stored.ID = "different-route"
			case "unknown-key":
				stored.Values["password"] = "not-supported"
			case "oversize":
				stored.Values["token"] = strings.Repeat("x", maxProfileCredentialBytes+1)
			case "permissions":
				require.NoError(t, root.Remove(name))
			}
			data, err = json.Marshal(stored)
			require.NoError(t, err)
			mode := os.FileMode(0o600)
			if mutation == "permissions" {
				mode = 0o644
			}
			require.NoError(t, root.WriteFile(name, data, mode))
			_, err = readDesiredConnections(root)
			require.Error(t, err)
		})
	}
}

func TestProfileCredentialChangeRetiresAuthorityWithoutPublicConfigChange(t *testing.T) {
	before := profileTestConnection("route", "endpoint")
	before.SetSensitiveData(map[string]any{"token": "old"})
	next := emptyDesiredConnections()
	next.Profiles = append(next.Profiles, desiredConnectionProfile{Source: "manual", Configuration: profileConfig(before), credentials: map[string]any{"token": "new"}})
	routes, retire := profileConnectionChanges([]types.Connection{before}, nil, next)
	require.Equal(t, []string{"route"}, routes)
	require.Equal(t, []string{"route"}, retire)
}

func TestProfileCredentialDiskFailureRollsBackPrivateSourceAndStore(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := connectionOverlayTestProvider()
	registerMockPlugin(ctrl, "plugin", provider)
	connection := profileTestConnection("route", "endpoint")
	oldToken, newToken := "old-private-token", "new-private-token"
	_, err := ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", connection, &ConnectionProfileCredentials{Token: &oldToken})
	require.NoError(t, err)
	root, err := ctrl.pluginStoreFn("plugin")
	require.NoError(t, err)
	attempt := 0
	provider.ApplyConnectionOverlayFunc = func(ctx context.Context, overlay resourcev2.ConnectionOverlay) error {
		attempt++
		if attempt == 1 {
			// A real filesystem obstruction rejects the atomic public commit.
			require.NoError(t, root.Rename(connectionProfileStoreName, "profile-backup"))
			require.NoError(t, root.MkdirAll(connectionProfileStoreName, 0o700))
		} else {
			require.NoError(t, root.Remove(connectionProfileStoreName))
			require.NoError(t, root.Rename("profile-backup", connectionProfileStoreName))
		}
		return provider.applyConnectionOverlay(ctx, overlay)
	}
	_, err = ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", connection, &ConnectionProfileCredentials{Token: &newToken})
	require.Error(t, err)
	require.Equal(t, "CONFLICT", resourcev2.ErrorCode(err))
	require.Equal(t, 2, attempt)
	state, err := readDesiredConnections(root)
	require.NoError(t, err)
	require.Equal(t, oldToken, state.overlay().Upserts[0].GetSensitiveData()["token"])
	effective, err := provider.ListConnections(context.Background())
	require.NoError(t, err)
	require.Equal(t, oldToken, effective[0].GetSensitiveData()["token"])
	entries, err := root.ReadDir(".")
	require.NoError(t, err)
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), profileCredentialPrefix) {
			data, err := root.ReadFile(entry.Name())
			require.NoError(t, err)
			require.NotContains(t, string(data), newToken)
		}
	}
}

func TestProfileCredentialInterruptedSaveRecoversOnlyCommittedReference(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	provider := connectionOverlayTestProvider()
	registerMockPlugin(ctrl, "plugin", provider)
	connection := profileTestConnection("route", "endpoint")
	oldToken, abandonedToken := "committed-private-token", "uncommitted-private-token"
	_, err := ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", connection, &ConnectionProfileCredentials{Token: &oldToken})
	require.NoError(t, err)
	root, err := ctrl.pluginStoreFn("plugin")
	require.NoError(t, err)
	state, err := readDesiredConnections(root)
	require.NoError(t, err)
	abandoned, err := prepareProfileCredentials(root, state, "manual", connection, &ConnectionProfileCredentials{Token: &abandonedToken})
	require.NoError(t, err)
	// Simulate a process exit after private-file fsync, before pointer commit.
	restarted := connectionOverlayTestProvider()
	registerMockPlugin(ctrl, "plugin", restarted)
	effective, err := ctrl.replayConnectionProfiles(testInvocationContext(), "plugin", nil)
	require.NoError(t, err)
	require.Equal(t, oldToken, effective[0].GetSensitiveData()["token"])
	_, err = root.Stat(profileCredentialPrefix + abandoned.CredentialsRef)
	require.True(t, os.IsNotExist(err))
	_, err = root.Stat(profileCredentialPrefix + state.Profiles[0].CredentialsRef)
	require.NoError(t, err)
}

func TestProfileCredentialInputBoundsRejectBeforePrivateFileCreation(t *testing.T) {
	root, err := appstate.NewTestService(t).PluginStore("test")
	require.NoError(t, err)
	for _, token := range []string{strings.Repeat("x", maxProfileCredentialBytes+1), string([]byte{0xff})} {
		_, err = prepareProfileCredentials(root, emptyDesiredConnections(), "manual", profileTestConnection("route", "endpoint"), &ConnectionProfileCredentials{Token: &token})
		require.Error(t, err)
		entries, err := root.ReadDir(".")
		require.NoError(t, err)
		require.Empty(t, entries)
	}
}

func TestProfileCredentialNumericConfigurationPreservesOnlyExactDestination(t *testing.T) {
	for _, numeric := range []struct {
		name    string
		initial any
		edited  any
		changed any
	}{
		{name: "wails-float", initial: float64(443), edited: float64(443), changed: float64(444)},
		{name: "large-integer", initial: json.Number("9007199254740993"), edited: json.Number("9007199254740993"), changed: json.Number("9007199254740992")},
	} {
		t.Run(numeric.name, func(t *testing.T) {
			ctrl, _ := newTestControllerWithEmitter(t)
			provider := connectionOverlayTestProvider()
			registerMockPlugin(ctrl, "plugin", provider)
			connection := profileTestConnection("route", "registry.example")
			connection.UID = "stable-incarnation"
			connection.Data["port"] = numeric.initial
			token := "numeric-config-private-token"
			_, err := ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", connection, &ConnectionProfileCredentials{Token: &token})
			require.NoError(t, err)
			root, err := ctrl.pluginStoreFn("plugin")
			require.NoError(t, err)
			persisted, err := readDesiredConnections(root)
			require.NoError(t, err)
			ref := persisted.Profiles[0].CredentialsRef
			// Disk uses json.Number; a normal Wails UI round trip uses float64.
			connection.Name = "Display edit after reload"
			connection.Data["port"] = numeric.edited
			_, err = ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", connection, nil)
			require.NoError(t, err)
			persisted, err = readDesiredConnections(root)
			require.NoError(t, err)
			require.Equal(t, ref, persisted.Profiles[0].CredentialsRef)
			require.Equal(t, token, persisted.overlay().Upserts[0].GetSensitiveData()["token"])
			connection.Data["port"] = numeric.changed
			_, err = ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", connection, nil)
			require.NoError(t, err)
			persisted, err = readDesiredConnections(root)
			require.NoError(t, err)
			require.Empty(t, persisted.Profiles[0].CredentialsRef)
			require.Empty(t, persisted.overlay().Upserts[0].GetSensitiveData())
		})
	}
}

func TestProfileCredentialMissingReferenceFailsClosedOnReload(t *testing.T) {
	ctrl, _ := newTestControllerWithEmitter(t)
	native := profileTestConnection("native", "endpoint")
	native.SetSensitiveData(map[string]any{"token": "native-secret"})
	registerMockPlugin(ctrl, "plugin", connectionOverlayTestProvider(native))
	token := "explicit-private-secret"
	_, err := ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", native, &ConnectionProfileCredentials{Token: &token})
	require.NoError(t, err)
	root, err := ctrl.pluginStoreFn("plugin")
	require.NoError(t, err)
	state, err := readDesiredConnections(root)
	require.NoError(t, err)
	require.NoError(t, root.Remove(profileCredentialPrefix+state.Profiles[0].CredentialsRef))
	restarted, _ := newTestControllerWithEmitter(t)
	restarted.pluginStoreFn = ctrl.pluginStoreFn
	ctrl = restarted
	registerMockPlugin(ctrl, "plugin", connectionOverlayTestProvider(native))
	effective, err := ctrl.replayConnectionProfiles(testInvocationContext(), "plugin", []types.Connection{native})
	require.Error(t, err)
	require.Empty(t, effective)
	require.Empty(t, ctrl.getConnections("plugin"), "missing private reference must never activate native fallback")
	require.NotContains(t, err.Error(), token)
}

func TestProfileCredentialsTamperedDestinationOrMissingBindingNeverReplays(t *testing.T) {
	for _, mutation := range []string{"endpoint", "missing-binding"} {
		t.Run(mutation, func(t *testing.T) {
			ctrl, _ := newTestControllerWithEmitter(t)
			connection := profileTestConnection("registry", "https://trusted.example")
			connection.UID = "same-incarnation"
			registerMockPlugin(ctrl, "plugin", connectionOverlayTestProvider(connection))
			token := "private-secret-not-for-attacker"
			_, err := ctrl.SaveConnectionProfile(testInvocationContext(), "plugin", connection, &ConnectionProfileCredentials{Token: &token})
			require.NoError(t, err)
			root, err := ctrl.pluginStoreFn("plugin")
			require.NoError(t, err)
			state, err := readDesiredConnections(root)
			require.NoError(t, err)
			if mutation == "endpoint" {
				// Preserve ID, UID, and immutable private reference.
				state.Profiles[0].Configuration.Data["endpoint"] = "https://attacker.example"
				public, err := encodeDesiredConnections(state)
				require.NoError(t, err)
				require.NoError(t, root.WriteFile(connectionProfileStoreName, public, 0o600))
			} else {
				name := profileCredentialPrefix + state.Profiles[0].CredentialsRef
				private, err := root.ReadFile(name)
				require.NoError(t, err)
				var record map[string]any
				require.NoError(t, json.Unmarshal(private, &record))
				delete(record, "dataDigest")
				private, err = json.Marshal(record)
				require.NoError(t, err)
				require.NoError(t, root.WriteFile(name, private, 0o600))
			}
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
			require.Zero(t, applies, "unbound credentials must never reach the provider")
			require.Empty(t, restarted.getConnections("plugin"))
		})
	}
}
