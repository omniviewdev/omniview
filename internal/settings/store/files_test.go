package store

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	bolt "go.etcd.io/bbolt"
)

func TestZeroAndRemoveOverwritesTheFileBeforeRemovingIt(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secret")
	// Larger than one write of zeros, and not a multiple of it.
	content := bytes.Repeat([]byte("s3cret-"), 40000)
	require.NoError(t, os.WriteFile(path, content, 0o600))
	witness := filepath.Join(dir, "witness")
	if err := os.Link(path, witness); err != nil {
		t.Skipf("hard links are not available here: %v", err)
	}

	require.NoError(t, zeroAndRemove(path))

	assert.False(t, exists(t, path))
	got, err := os.ReadFile(witness)
	require.NoError(t, err)
	assert.Equal(t, make([]byte, len(content)), got)
}

func TestZeroAndRemoveOfAnEmptyFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "empty")
	require.NoError(t, os.WriteFile(path, nil, 0o600))

	require.NoError(t, zeroAndRemove(path))

	assert.False(t, exists(t, path))
}

func TestZeroAndRemoveOfAFileThatIsNotThereIsNotAnError(t *testing.T) {
	require.NoError(t, zeroAndRemove(filepath.Join(t.TempDir(), "missing")))
}

func TestZeroAndRemoveRefusesWhatIsNotARegularFile(t *testing.T) {
	dir := t.TempDir()
	directory := filepath.Join(dir, "directory")
	require.NoError(t, os.Mkdir(directory, 0o700))
	require.ErrorIs(t, zeroAndRemove(directory), errNotRegular)
	assert.True(t, exists(t, directory))

	target := filepath.Join(dir, "target")
	require.NoError(t, os.WriteFile(target, []byte("kept"), 0o600))
	link := filepath.Join(dir, "link")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symbolic links are not available here: %v", err)
	}
	require.ErrorIs(t, zeroAndRemove(link), errNotRegular)
	got, err := os.ReadFile(target)
	require.NoError(t, err)
	assert.Equal(t, "kept", string(got), "nothing is written through a link")
}

// buildDatabase makes a database at path holding the given top-level buckets.
func buildDatabase(t *testing.T, fill func(*bolt.Tx) error) *bolt.DB {
	t.Helper()
	db, err := bolt.Open(filepath.Join(t.TempDir(), "x.db"), 0o600, nil)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	require.NoError(t, db.Update(fill))
	return db
}

func TestCompareBucketsWalksKeysValuesAndNestedBuckets(t *testing.T) {
	fill := func(value, nested string) func(*bolt.Tx) error {
		return func(tx *bolt.Tx) error {
			top, err := tx.CreateBucket([]byte("top"))
			if err != nil {
				return err
			}
			if err = top.Put([]byte("a"), []byte("1")); err != nil {
				return err
			}
			inner, err := top.CreateBucket([]byte("inner"))
			if err != nil {
				return err
			}
			if err = inner.Put([]byte("k"), []byte(nested)); err != nil {
				return err
			}
			return top.Put([]byte("z"), []byte(value))
		}
	}
	same := buildDatabase(t, fill("v", "n"))
	for name, other := range map[string]*bolt.DB{
		"a value":        buildDatabase(t, fill("changed", "n")),
		"a nested value": buildDatabase(t, fill("v", "changed")),
		"a key as a bucket": buildDatabase(t, func(tx *bolt.Tx) error {
			top, err := tx.CreateBucket([]byte("top"))
			if err != nil {
				return err
			}
			if _, err = top.CreateBucket([]byte("a")); err != nil {
				return err
			}
			return top.Put([]byte("z"), []byte("v"))
		}),
		"fewer keys": buildDatabase(t, func(tx *bolt.Tx) error {
			top, err := tx.CreateBucket([]byte("top"))
			if err != nil {
				return err
			}
			return top.Put([]byte("a"), []byte("1"))
		}),
	} {
		t.Run(name, func(t *testing.T) {
			require.NoError(t, same.View(func(a *bolt.Tx) error {
				return other.View(func(b *bolt.Tx) error {
					require.ErrorIs(t, compareBuckets(a.Bucket([]byte("top")), b.Bucket([]byte("top"))), errCopyDiffers)
					require.ErrorIs(t, compareBuckets(b.Bucket([]byte("top")), a.Bucket([]byte("top"))), errCopyDiffers)
					return nil
				})
			}))
		})
	}

	twin := buildDatabase(t, fill("v", "n"))
	require.NoError(t, same.View(func(a *bolt.Tx) error {
		return twin.View(func(b *bolt.Tx) error {
			require.NoError(t, compareBuckets(a.Bucket([]byte("top")), b.Bucket([]byte("top"))))
			return nil
		})
	}))
}
