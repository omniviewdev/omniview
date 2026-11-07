package devworkspace

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/omniviewdev/omniview/internal/devcontract"
	"github.com/stretchr/testify/require"
)

func TestConcurrentCreatesReportCollectionNotWorkspaceContention(t *testing.T) {
	m, root := fixtureManager(t)
	type result struct {
		slug    string
		err     error
		elapsed time.Duration
	}
	start := make(chan struct{})
	done := make(chan result, 8)
	for i := range 8 {
		go func(i int) {
			<-start
			slug := fmt.Sprintf("concurrent-%d", i)
			now := time.Now()
			_, err := m.Create(context.Background(), CreateOptions{Slug: slug})
			done <- result{slug, err, time.Since(now)}
		}(i)
	}
	close(start)
	var refused []string
	for range 8 {
		r := <-done
		if r.err == nil {
			t.Logf("successful create collection-hold upper bound=%s", r.elapsed)
			continue
		}
		var conflict *devcontract.Error
		require.True(t, errors.As(r.err, &conflict), "%v", r.err)
		require.Equal(t, "collection_busy", conflict.Code)
		require.Contains(t, conflict.Message, root)
		require.NoDirExists(t, filepath.Join(root, "workspaces", r.slug))
		refused = append(refused, r.slug)
		t.Logf("fail-fast collection contender wait=%s", r.elapsed)
	}
	// Explicit retries happen only after every original operation has finished.
	for _, slug := range refused {
		_, err := m.Create(context.Background(), CreateOptions{Slug: slug})
		require.NoError(t, err)
	}
	items, err := m.List(context.Background())
	require.NoError(t, err)
	require.Len(t, items, 8)
}

func TestProfileLockContentionPreservesDistinctRole(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".lock")
	release, err := tryLock(path)
	require.NoError(t, err)
	defer release()
	_, err = tryLock(path)
	var conflict *devcontract.Error
	require.True(t, errors.As(err, &conflict), "%v", err)
	require.Equal(t, "workspace_busy", conflict.Code)
	require.Contains(t, conflict.Message, path)
}
