// internal/appstate/lock_test.go
package appstate

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAcquireLock(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	lockPath := filepath.Join(dir, ".lock")

	l, err := acquireLock(lockPath)
	require.NoError(t, err)
	defer releaseLock(l)
}

func TestAcquireLock_Contention(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	lockPath := filepath.Join(dir, ".lock")

	l1, err := acquireLock(lockPath)
	require.NoError(t, err)
	defer releaseLock(l1)

	_, err = acquireLock(lockPath)
	assert.Error(t, err, "second lock should fail with contention error")
}
