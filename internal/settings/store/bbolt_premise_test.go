package store

import (
	"bytes"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	bolt "go.etcd.io/bbolt"
)

// These tests pin the facts the scrub rests on, about bbolt itself and not about
// the store. If one fails, bbolt began to wipe what it frees, and the scrub is
// worth a second look.

const premisePlanted = "premise-sentinel-8c41d7a09e3b"

func premiseDatabase(t *testing.T, opts *bolt.Options) (*bolt.DB, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "premise.db")
	db, err := bolt.Open(path, 0o600, opts)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	require.NoError(t, db.Update(func(tx *bolt.Tx) error {
		for _, name := range []string{"plugins", "core"} {
			if _, bucketErr := tx.CreateBucket([]byte(name)); bucketErr != nil {
				return bucketErr
			}
		}
		return nil
	}))
	return db, path
}

func premiseCopies(t *testing.T, path string) int {
	t.Helper()
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	return bytes.Count(data, []byte(premisePlanted))
}

func TestBboltLeavesAValueInTheFileAfterItIsOverwrittenWithZerosAndDeleted(t *testing.T) {
	db, path := premiseDatabase(t, nil)
	value := []byte(`{"token":"` + premisePlanted + `"}`)
	require.NoError(t, db.Update(func(tx *bolt.Tx) error {
		return tx.Bucket([]byte("plugins")).Put([]byte("flux"), value)
	}))
	require.Equal(t, 1, premiseCopies(t, path))

	// The zeros are written to a new page; the page that holds the value is freed as it was.
	require.NoError(t, db.Update(func(tx *bolt.Tx) error {
		bucket := tx.Bucket([]byte("plugins"))
		if err := bucket.Put([]byte("flux"), make([]byte, len(value))); err != nil {
			return err
		}
		return bucket.Delete([]byte("flux"))
	}))

	assert.Equal(t, 1, premiseCopies(t, path), "the old bytes are still in the file")
}

func TestBboltLeavesAValueThatSpansPagesInTheFileThroughManyUnrelatedWrites(t *testing.T) {
	// Which of the options bbolt has changes nothing: none of them wipes a page.
	for name, opts := range map[string]*bolt.Options{
		"defaults":              nil,
		"no freelist sync":      {NoFreelistSync: true},
		"hashmap freelist":      {FreelistType: bolt.FreelistMapType},
		"hashmap, no sync list": {FreelistType: bolt.FreelistMapType, NoFreelistSync: true},
	} {
		t.Run(name, func(t *testing.T) {
			db, path := premiseDatabase(t, opts)
			for i := range 20 {
				require.NoError(t, db.Update(func(tx *bolt.Tx) error {
					return tx.Bucket([]byte("plugins")).Put([]byte("filler-"+strconv.Itoa(i)), []byte(`{"theme":"dark"}`))
				}))
			}
			// A value of three pages and a bit, such as a PEM key: its tail is the last
			// thing in the last page of a run of overflow pages.
			big := bytes.Repeat([]byte("A"), 3*os.Getpagesize())
			value := append(append([]byte(`{"pem":"`), big...), []byte(premisePlanted+`"}`)...)
			require.NoError(t, db.Update(func(tx *bolt.Tx) error {
				return tx.Bucket([]byte("plugins")).Put([]byte("flux"), value)
			}))
			require.Equal(t, 1, premiseCopies(t, path))

			require.NoError(t, db.Update(func(tx *bolt.Tx) error {
				return tx.Bucket([]byte("plugins")).Delete([]byte("flux"))
			}))
			assert.Equal(t, 1, premiseCopies(t, path), "deleted, and still in the file")

			for i := range 30 {
				require.NoError(t, db.Update(func(tx *bolt.Tx) error {
					return tx.Bucket([]byte("core")).Put([]byte("w"), []byte(strconv.Itoa(i)))
				}))
			}
			if name == "defaults" || name == "no freelist sync" {
				assert.Equal(t, 1, premiseCopies(t, path), "30 unrelated writes did not reuse its pages")
			}
		})
	}
}
