package instance

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func nativeTestEnvironment(entries []string) map[string]string {
	out := map[string]string{}
	for _, entry := range entries {
		key, value, _ := strings.Cut(entry, "=")
		out[key] = value
	}
	return out
}

// Losing original absence/empty distinction changes tool credential discovery.
func TestNativeHostEnvironmentRestoresToolContexts(t *testing.T) {
	p := Profile{WebviewRoot: filepath.Join(t.TempDir(), "webview")}
	for _, original := range [][]string{nil, {"XDG_DATA_HOME=", "XDG_CACHE_HOME="}, {"XDG_DATA_HOME=/real/data", "XDG_CACHE_HOME=/real/cache"}} {
		base := append([]string{"HOME=/real/home", "XDG_CONFIG_HOME=/real/config", "XDG_RUNTIME_DIR=/run/user/501", "DBUS_SESSION_BUS_ADDRESS=session", "AWS_PROFILE=tools", "OMNIVIEW_NATIVE_ORIGINAL_XDG=forged"}, original...)
		host, err := p.NativeHostEnvironment(base)
		require.NoError(t, err)
		selected := nativeTestEnvironment(host)
		require.Equal(t, filepath.Join(p.WebviewRoot, "data"), selected["XDG_DATA_HOME"])
		require.Equal(t, filepath.Join(p.WebviewRoot, "cache"), selected["XDG_CACHE_HOME"])
		tools, err := RestoreNativeChildEnvironment(host)
		require.NoError(t, err)
		actual := nativeTestEnvironment(tools)
		expected := nativeTestEnvironment(base)
		delete(expected, "OMNIVIEW_NATIVE_ORIGINAL_XDG")
		require.Equal(t, expected, actual)
		for _, plugin := range []string{"", "aws"} {
			childEnvironment, err := p.ChildEnvironment(host, plugin)
			require.NoError(t, err)
			child := nativeTestEnvironment(childEnvironment)
			for _, key := range []string{"HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "AWS_PROFILE"} {
				value, present := expected[key]
				got, exists := child[key]
				require.Equal(t, present, exists, key)
				require.Equal(t, value, got, key)
			}
		}
	}
}

func TestNativeChildLaunchRefusesInvalidRestoreMetadata(t *testing.T) {
	p := Profile{}
	for _, base := range [][]string{
		{"OMNIVIEW_NATIVE_ORIGINAL_XDG=not-json"},
		{"OMNIVIEW_NATIVE_ORIGINAL_XDG={}", "OMNIVIEW_NATIVE_ORIGINAL_XDG={}"},
		{`OMNIVIEW_NATIVE_ORIGINAL_XDG={"XDG_DATA_HOME":{"present":true,"value":"/real","unknown":true},"XDG_CACHE_HOME":{"present":false,"value":""}}`},
	} {
		environment, err := p.ChildEnvironment(base, "plugin")
		require.Error(t, err)
		require.Nil(t, environment, "invalid metadata must fail, not launch with a truncated credential context")
		_, err = PluginEnvironment(t.TempDir(), "plugin", base)
		require.Error(t, err)
	}
}

func TestDirectNativeLinuxLaunchCannotLoseOriginalToolRoots(t *testing.T) {
	p := Profile{WebviewRoot: filepath.Join(t.TempDir(), "webview")}
	values := map[string]string{"XDG_DATA_HOME": filepath.Join(p.WebviewRoot, "data"), "XDG_CACHE_HOME": filepath.Join(p.WebviewRoot, "cache")}
	require.Error(t, p.ValidateNativeHostEnvironment(func(key string) string { return values[key] }))
	host, err := p.NativeHostEnvironment([]string{"XDG_DATA_HOME=/tools/data"})
	require.NoError(t, err)
	values = nativeTestEnvironment(host)
	require.NoError(t, p.ValidateNativeHostEnvironment(func(key string) string { return values[key] }))
}
