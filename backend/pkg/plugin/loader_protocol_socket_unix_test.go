//go:build !windows

package plugin

import (
	"net"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// leftSocket makes the file a plugin that was killed leaves in its directory: a unix socket that nothing listens on.
func leftSocket(t *testing.T, path string) {
	t.Helper()
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	require.NoError(t, err)
	listener.SetUnlinkOnClose(false)
	require.NoError(t, listener.Close())
	info, err := os.Lstat(path)
	require.NoError(t, err)
	require.Equal(t, os.ModeSocket, info.Mode().Type(), "the fixture is a socket")
}

func exists(path string) bool {
	_, err := os.Lstat(path)
	return err == nil
}

func TestTheSocketOfARefusedPluginIsRemovedOnlyWhenItCanBeNothingButWhatAGoPluginServerMade(t *testing.T) {
	dir := shortSocketRoot(t, "ul-")
	elsewhere := shortSocketRoot(t, "ul-")
	address := func(path string) net.Addr { return &net.UnixAddr{Name: path, Net: "unix"} }
	envOf := func(entries ...string) []string { return entries }

	// What it removes: the socket a go-plugin server makes in the directory the plugin was given.
	for name, env := range map[string][]string{
		"in its TMPDIR":                             envOf("A=b", "TMPDIR="+dir),
		"in its TMPDIR, given with a trailing /":    envOf("TMPDIR=" + dir + "/"),
		"in its PLUGIN_UNIX_SOCKET_DIR over TMPDIR": envOf("PLUGIN_UNIX_SOCKET_DIR="+dir, "TMPDIR="+elsewhere),
		"in the last TMPDIR the environment has":    envOf("TMPDIR="+elsewhere, "TMPDIR="+dir),
	} {
		t.Run("removes the socket "+name, func(t *testing.T) {
			path := filepath.Join(dir, "plugin1234567")
			leftSocket(t, path)

			unlinkAdvertisedSocket(address(path), env)

			assert.False(t, exists(path))
		})
	}

	// What it leaves alone, whatever the plugin says: a path it was not given to use, a name a go-plugin server does not make, a file that is not a socket, and a link.
	file := func(t *testing.T, path string) { require.NoError(t, os.WriteFile(path, []byte("not a socket"), 0o600)) }
	link := func(t *testing.T, path string) {
		target := filepath.Join(dir, "plugin9")
		leftSocket(t, target)
		require.NoError(t, os.Symlink(target, path))
	}
	directory := func(t *testing.T, path string) { require.NoError(t, os.Mkdir(path, 0o700)) }
	for name, c := range map[string]struct {
		make func(t *testing.T, path string)
		path string
		env  []string
	}{
		"a socket in another directory":                                {make: leftSocket, path: filepath.Join(elsewhere, "plugin1"), env: envOf("TMPDIR=" + dir)},
		"a socket in TMPDIR when PLUGIN_UNIX_SOCKET_DIR names another": {make: leftSocket, path: filepath.Join(dir, "plugin1"), env: envOf("TMPDIR="+dir, "PLUGIN_UNIX_SOCKET_DIR="+elsewhere)},
		"a socket in a directory below TMPDIR":                         {make: leftSocket, path: filepath.Join(dir, "below", "plugin1"), env: envOf("TMPDIR=" + dir)},
		"a socket with another name":                                   {make: leftSocket, path: filepath.Join(dir, "other1"), env: envOf("TMPDIR=" + dir)},
		"a socket named plugin and letters":                            {make: leftSocket, path: filepath.Join(dir, "plugin1a"), env: envOf("TMPDIR=" + dir)},
		"a socket named only plugin":                                   {make: leftSocket, path: filepath.Join(dir, "plugin"), env: envOf("TMPDIR=" + dir)},
		"a socket that is plugin with a prefix":                        {make: leftSocket, path: filepath.Join(dir, "xplugin1"), env: envOf("TMPDIR=" + dir)},
		"a regular file with the name of a socket":                     {make: file, path: filepath.Join(dir, "plugin2"), env: envOf("TMPDIR=" + dir)},
		"a link to a socket with the name of a socket":                 {make: link, path: filepath.Join(dir, "plugin3"), env: envOf("TMPDIR=" + dir)},
		"a directory with the name of a socket":                        {make: directory, path: filepath.Join(dir, "plugin4"), env: envOf("TMPDIR=" + dir)},
		"a path that climbs out of its directory":                      {make: leftSocket, path: dir + "/below/../plugin5", env: envOf("TMPDIR=" + dir)},
	} {
		t.Run("leaves "+name, func(t *testing.T) {
			if err := os.MkdirAll(filepath.Dir(c.path), 0o700); err != nil && !os.IsExist(err) {
				require.NoError(t, err)
			}
			cleaned := filepath.Clean(c.path)
			c.make(t, cleaned)

			unlinkAdvertisedSocket(address(c.path), c.env)

			assert.True(t, exists(cleaned), "it is still there")
		})
	}

	t.Run("leaves a relative path: the name of a socket in the directory the host is in", func(t *testing.T) {
		t.Chdir(dir)
		leftSocket(t, filepath.Join(dir, "plugin41"))

		unlinkAdvertisedSocket(address("plugin41"), envOf("TMPDIR="+dir))

		assert.True(t, exists(filepath.Join(dir, "plugin41")), "a relative path is not a path the plugin was given to use")
	})

	t.Run("leaves an address that is not a unix socket's, and does nothing for no address", func(t *testing.T) {
		path := filepath.Join(dir, "plugin42")
		leftSocket(t, path)

		unlinkAdvertisedSocket(&net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 4000}, envOf("TMPDIR="+dir))
		unlinkAdvertisedSocket(&net.UnixAddr{Name: path, Net: "unixgram"}, envOf("TMPDIR="+dir))
		unlinkAdvertisedSocket(nil, envOf("TMPDIR="+dir))

		assert.True(t, exists(path))
	})
}

func TestTheLastValueOfAKeyIsTheOneTheSystemTakes(t *testing.T) {
	env := []string{"A=1", "B=2", "A=3", "C", "=D", "AB=4"}

	assert.Equal(t, "3", lastEnv(env, "A"))
	assert.Equal(t, "2", lastEnv(env, "B"))
	assert.Equal(t, "4", lastEnv(env, "AB"))
	assert.Empty(t, lastEnv(env, "C"), "an entry with no value is not a value")
	assert.Empty(t, lastEnv(env, "Z"))
}
