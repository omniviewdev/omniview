package devbaseline

import (
	"context"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
	"time"

	settingsstore "github.com/omniviewdev/omniview/internal/settings/store"
	"github.com/stretchr/testify/require"
)

func TestValidMetadataDamagedFreelistFailsWithoutCrashingOrMutating(t *testing.T) {
	home, source, _ := fixture(t)
	data := sourceSettings(t, source)
	// bbolt 1.4.3 native-endian metadata: page header 16 bytes, pageSize +8,
	// freelist +32 and transaction ID +48 within metadata. Metadata stays valid.
	pageSize := int(binary.NativeEndian.Uint32(data[24:28]))
	require.Greater(t, pageSize, 0)
	meta := 16
	if binary.NativeEndian.Uint64(data[pageSize+64:pageSize+72]) > binary.NativeEndian.Uint64(data[64:72]) {
		meta = pageSize + 16
	}
	freelist := binary.NativeEndian.Uint64(data[meta+32 : meta+40])
	require.NotZero(t, freelist)
	offset := int(freelist)*pageSize + 8
	require.Less(t, offset+2, len(data))
	firstMeta := append([]byte(nil), data[:pageSize*2]...)
	binary.NativeEndian.PutUint16(data[offset:offset+2], 0)
	require.Equal(t, firstMeta, data[:pageSize*2])
	require.NoError(t, os.WriteFile(filepath.Join(source, "settings.db"), data, 0600))
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_, err := Snapshot(ctx, SnapshotOptions{SourceRoot: source, TemporaryRoot: home})
	require.Error(t, err)
	after, err := os.ReadFile(filepath.Join(source, "settings.db"))
	require.NoError(t, err)
	require.Equal(t, data, after)
}

func TestPersistedEditorNumericFontWeightRemainsUsable(t *testing.T) {
	home, source, p := fixture(t)
	s, err := settingsstore.Open(filepath.Join(source, "settings.db"))
	require.NoError(t, err)
	require.NoError(t, s.SaveCategory("editor", map[string]any{"fontWeight": 11, "fontSize": 11, "theme": "application", "folding": true}))
	require.NoError(t, s.Close())
	result, err := Seed(context.Background(), SnapshotOptions{SourceRoot: source, TemporaryRoot: home}, ImportOptions{Destination: p, Home: home})
	require.NoError(t, err)
	s, err = settingsstore.Open(filepath.Join(result.StateRoot, "settings.db"))
	require.NoError(t, err)
	defer s.Close()
	values, err := s.LoadCategory("editor")
	require.NoError(t, err)
	require.Equal(t, float64(11), values["fontWeight"])
	_, err = safePreferences(map[string]map[string]any{"general": {"language": float64(11)}})
	require.Error(t, err)
	_, err = safePreferences(map[string]map[string]any{"editor": {"theme": float64(11)}})
	require.Error(t, err)
}

func TestSourceLockReplacementSymlinkCannotCreateSentinel(t *testing.T) {
	home, source, _ := fixture(t)
	path := filepath.Join(source, ".lock")
	require.NoError(t, os.WriteFile(path, nil, 0600))
	_, err := regularInfo(path)
	require.NoError(t, err)
	require.NoError(t, os.Rename(path, filepath.Join(source, "original-lock")))
	target := filepath.Join(home, "must-not-be-created")
	if err := os.Symlink(target, path); err != nil {
		t.Skip(err)
	}
	release, _, err := acquireSourceLock(path)
	if err == nil {
		_ = release()
	}
	require.Error(t, err)
	_, err = os.Lstat(target)
	require.True(t, os.IsNotExist(err))
}

func TestOwnedStageCleanupPreservesReplacement(t *testing.T) {
	home, _, _ := fixture(t)
	stage, err := newOwnedStage(home, ".baseline-stage-")
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(stage.path, "owned"), []byte("owned"), 0600))
	moved := filepath.Join(home, "moved-owned-stage")
	require.NoError(t, os.Rename(stage.path, moved))
	require.NoError(t, os.Mkdir(stage.path, 0700))
	sentinel := filepath.Join(stage.path, "sentinel")
	require.NoError(t, os.WriteFile(sentinel, []byte("foreign"), 0600))
	require.NoError(t, stage.cleanup())
	bytes, err := os.ReadFile(sentinel)
	require.NoError(t, err)
	require.Equal(t, "foreign", string(bytes))
}

func TestPublishedStageDisarmsCleanupOfRecreatedOldPath(t *testing.T) {
	home, _, _ := fixture(t)
	stage, err := newOwnedStage(home, ".baseline-stage-")
	require.NoError(t, err)
	destination := filepath.Join(home, "published")
	require.NoError(t, finalize(stage.path, destination))
	stage.disarm()
	require.NoError(t, os.Mkdir(stage.path, 0700))
	sentinel := filepath.Join(stage.path, "sentinel")
	require.NoError(t, os.WriteFile(sentinel, []byte("foreign"), 0600))
	require.NoError(t, stage.cleanup())
	bytes, err := os.ReadFile(sentinel)
	require.NoError(t, err)
	require.Equal(t, "foreign", string(bytes))
	_, err = os.Stat(destination)
	require.NoError(t, err)
}

func TestOwnedStageCanFinalizeWithRetainedOwnership(t *testing.T) {
	home, _, _ := fixture(t)
	stage, err := newOwnedStage(home, ".baseline-stage-")
	require.NoError(t, err)
	require.NoError(t, stage.root.WriteFile("payload", []byte("independent"), 0600))
	destination := filepath.Join(home, "state")
	require.NoError(t, finalize(stage.path, destination))
	stage.disarm()
	require.NoError(t, stage.cleanup())
	bytes, err := os.ReadFile(filepath.Join(destination, "payload"))
	require.NoError(t, err)
	require.Equal(t, "independent", string(bytes))
}

func TestOwnedStageFailureCleanupRemovesStageWithRetainedOwnership(t *testing.T) {
	for _, prefix := range []string{".baseline-stage-", ".baseline-legacy-"} {
		t.Run(prefix, func(t *testing.T) {
			home, _, _ := fixture(t)
			stage, err := newOwnedStage(home, prefix)
			require.NoError(t, err)
			require.NoError(t, stage.root.WriteFile("payload", []byte("private"), 0600))
			require.NoError(t, stage.cleanup())
			_, err = os.Lstat(stage.path)
			require.True(t, os.IsNotExist(err))
		})
	}
}
