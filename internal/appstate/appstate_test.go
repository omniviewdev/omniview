package appstate

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNew_CreatesRootDir(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	svc, err := New(WithRoot(dir+"/state"), WithFlock(false))
	require.NoError(t, err)
	defer svc.Close()
	assert.Equal(t, dir+"/state", svc.Root())
}

func TestNew_Accessors(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	svc, err := New(WithRoot(dir), WithFlock(false))
	require.NoError(t, err)
	defer svc.Close()
	assert.NoError(t, svc.Plugins().WriteFile("test.txt", []byte("p"), 0644))
	assert.NoError(t, svc.Logs().WriteFile("test.txt", []byte("l"), 0644))
	assert.NoError(t, svc.RootDir().WriteFile("test.txt", []byte("r"), 0644))
}

func TestNew_PluginDataAccessor(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	svc, err := New(WithRoot(dir), WithFlock(false))
	require.NoError(t, err)
	defer svc.Close()
	pd, err := svc.PluginData("my-plugin")
	require.NoError(t, err)
	require.NoError(t, pd.WriteFile("key.json", []byte(`{"v":1}`), 0600))
	got, err := pd.ReadFile("key.json")
	require.NoError(t, err)
	assert.JSONEq(t, `{"v":1}`, string(got))
}

func TestNew_PluginStoreAccessor(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	svc, err := New(WithRoot(dir), WithFlock(false))
	require.NoError(t, err)
	defer svc.Close()
	ps, err := svc.PluginStore("my-plugin")
	require.NoError(t, err)
	require.NoError(t, ps.WriteFile("resource", []byte("binary-data"), 0600))
}

func TestNew_FlockContention(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	svc1, err := New(WithRoot(dir))
	require.NoError(t, err)
	defer svc1.Close()
	_, err = New(WithRoot(dir))
	assert.Error(t, err, "second New on same dir should fail")
}

func TestNewTestService(t *testing.T) {
	t.Parallel()
	svc := NewTestService(t)
	require.NoError(t, svc.RootDir().WriteFile("test.txt", []byte("ok"), 0644))
}
