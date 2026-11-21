package store

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"slices"

	bolt "go.etcd.io/bbolt"
)

// pluginSchemasBucketName names the bucket in which the host remembers, per
// plugin ID, which of the settings the plugin declared are ordinary preferences
// (see pluginSchemaDocument). The key is the plugin ID, like the values bucket.
const pluginSchemasBucketName = "plugin-schemas"

// pluginSchemaVersion is the version of pluginSchemaDocument. A document of any
// other version is treated as absent, so every value is erased (fail closed).
const pluginSchemaVersion = 1

// The schema is supplied by the plugin: bound what the host keeps of it.
const (
	maxRememberedSettings = 4096
	maxRememberedIDBytes  = 256
)

// ErrSchemaTooLarge reports that a plugin's schema has too many settings, or a
// setting ID too long, for the host to remember. Nothing is remembered for the
// plugin then, and what was remembered before is dropped.
var ErrSchemaTooLarge = errors.New("plugin settings schema is too large to remember")

// pluginSchemaDocument is what the host remembers of a plugin's settings schema
// once the plugin stops: the IDs of the settings it declared that are neither
// Sensitive nor a Password. It is never a label, a default, an option or a value:
// the defaults and options of a sensitive setting can be credentials themselves.
//
// Additive changes keep Ordinary's meaning; anything else bumps the version.
type pluginSchemaDocument struct {
	Version  int      `json:"v"`
	Ordinary []string `json:"ordinary"`
}

// DeclaredSettings is what a plugin's schema says about its stored values: the
// IDs of the declared settings that are ordinary preferences. Every other stored
// value is credential-class for an uninstall: a declared Sensitive or Password
// setting, or a value no setting is declared for.
type DeclaredSettings struct {
	Ordinary []string
}

// EraseBasis names what told an erase which of a plugin's stored values are
// ordinary: the knowledge it classified them by.
type EraseBasis string

const (
	// EraseBasisSession: the schema the running host learned from the plugin.
	EraseBasisSession EraseBasis = "session"
	// EraseBasisRemembered: the schema remembered from an earlier start.
	EraseBasisRemembered EraseBasis = "remembered"
	// EraseBasisNone: the host knows no schema for the plugin, so nothing proves a
	// stored value is ordinary and every value was erased.
	EraseBasisNone EraseBasis = "none"
)

// EraseResult says what ErasePluginSettings did.
type EraseResult struct {
	// Erased and Kept count the stored values removed and the ones left in place.
	Erased int
	Kept   int
	// Basis says which schema classified the values. EraseBasisNone is the
	// conservative case: every stored value was erased.
	Basis EraseBasis
	// Unreadable is set when the plugin's entry could not be decoded and was
	// removed whole, because its values could not be told apart.
	Unreadable bool
}

// RememberPluginSchema stores which settings a plugin declares as ordinary
// preferences, replacing what was remembered before: the last known schema is
// kept, not a union, so a setting that became Sensitive is erased. The host calls
// it each time it learns the plugin's schema, before any value is stored for that
// schema, so that an uninstall can tell credentials from preferences without a
// running plugin. A schema that has not changed since it was last remembered
// causes no write.
//
// A schema over the bounds is not remembered, whatever was remembered before is
// dropped, and ErrSchemaTooLarge is returned.
func (s *Store) RememberPluginSchema(pluginID string, ordinary []string) error {
	return s.persistOperation("settings.PluginSchema", "", pluginID, func() error {
		return s.rememberPluginSchema(pluginID, ordinary)
	})
}

func (s *Store) rememberPluginSchema(pluginID string, ordinary []string) error {
	if s == nil || s.db == nil {
		return ErrUnavailable
	}
	ids := slices.Compact(slices.Sorted(slices.Values(ordinary)))
	if ids == nil {
		ids = []string{}
	}
	if schemaTooLargeToRemember(ids) {
		// An earlier, possibly more permissive schema must not stand in for this one.
		if err := s.forgetPluginSchema(pluginID); err != nil {
			return err
		}
		return ErrSchemaTooLarge
	}
	data, err := json.Marshal(pluginSchemaDocument{Version: pluginSchemaVersion, Ordinary: ids})
	if err != nil {
		return fmt.Errorf("encode plugin schema %q: %w", pluginID, err)
	}
	key := []byte(pluginID)
	unchanged := false
	if err = s.db.View(func(tx *bolt.Tx) error {
		if bucket := pluginSchemas(tx); bucket != nil {
			unchanged = bytes.Equal(bucket.Get(key), data)
		}
		return nil
	}); err != nil {
		return err
	}
	if unchanged {
		return nil
	}
	return s.db.Update(func(tx *bolt.Tx) error {
		bucket, bucketErr := tx.CreateBucketIfNotExists([]byte(pluginSchemasBucketName))
		if bucketErr != nil {
			return fmt.Errorf("create plugin schemas bucket: %w", bucketErr)
		}
		return bucket.Put(key, data)
	})
}

func schemaTooLargeToRemember(ids []string) bool {
	return len(ids) > maxRememberedSettings || slices.ContainsFunc(ids, func(id string) bool {
		return len(id) > maxRememberedIDBytes
	})
}

// ForgetPluginSchema drops what is remembered of a plugin's schema. It is a no-op
// if nothing is remembered.
func (s *Store) ForgetPluginSchema(pluginID string) error {
	return s.persistOperation("settings.PluginSchema", "", pluginID, func() error {
		return s.forgetPluginSchema(pluginID)
	})
}

func (s *Store) forgetPluginSchema(pluginID string) error {
	if s == nil || s.db == nil {
		return ErrUnavailable
	}
	return s.db.Update(func(tx *bolt.Tx) error {
		if bucket := pluginSchemas(tx); bucket != nil {
			return bucket.Delete([]byte(pluginID))
		}
		return nil
	})
}

// LoadPluginSchema returns the remembered IDs of the plugin's ordinary settings,
// sorted. found is false when nothing usable is remembered: no entry, a version
// this host does not know, or a document that cannot be read.
func (s *Store) LoadPluginSchema(pluginID string) ([]string, bool, error) {
	if s == nil || s.db == nil {
		return nil, false, ErrUnavailable
	}
	var ordinary []string
	found := false
	err := s.db.View(func(tx *bolt.Tx) error {
		if keep, ok := rememberedOrdinary(tx, pluginID); ok {
			found = true
			ordinary = slices.Sorted(maps.Keys(keep))
		}
		return nil
	})
	return ordinary, found, err
}

func pluginSchemas(tx *bolt.Tx) *bolt.Bucket {
	return tx.Bucket([]byte(pluginSchemasBucketName))
}

// rememberedOrdinary reads the remembered ordinary setting IDs of a plugin. It
// fails closed: no entry, an undecodable document, a version this host does not
// know or a document without the list all mean that nothing is remembered.
func rememberedOrdinary(tx *bolt.Tx, pluginID string) (map[string]struct{}, bool) {
	bucket := pluginSchemas(tx)
	if bucket == nil {
		return nil, false
	}
	data := bucket.Get([]byte(pluginID))
	if data == nil {
		return nil, false
	}
	var document pluginSchemaDocument
	if err := json.Unmarshal(data, &document); err != nil ||
		document.Version != pluginSchemaVersion || document.Ordinary == nil {
		return nil, false
	}
	ordinary := make(map[string]struct{}, len(document.Ordinary))
	for _, id := range document.Ordinary {
		ordinary[id] = struct{}{}
	}
	return ordinary, true
}

// ErasePluginSettings removes, in one transaction, the credential-class values
// of a plugin and keeps the declared ordinary ones as they are. A stored value is
// kept only if its setting is known to be ordinary; a declared Sensitive or
// Password setting, and a value nothing declares, are erased.
//
// current is the schema the running host last learned from the plugin. When it
// is nil the schema remembered from an earlier start decides, and when nothing
// usable is remembered either, every value is erased and the result says so
// (EraseBasisNone). The plugin's entry, and what is remembered of its schema, are
// removed when no value is kept; while kept values remain the remembered schema
// stays, so that uninstalling a reinstalled plugin that never started again
// classifies them the same way. An entry that cannot be decoded is removed whole
// with its schema, because its values cannot be told apart. It is a no-op if the
// plugin has no entry.
//
// The erase reaches the file too, not only the live database. bbolt is
// copy-on-write and does not zero the pages it frees, so the erased value would
// stay readable in the file until a later write happened to reuse its page. The
// transaction therefore sets the scrub marker, and once it has committed the
// store replaces the database file with a compacted copy and overwrites the old
// file (see scrub.go). When that fails the values are still erased; the error
// wraps ErrScrubFailed, the result is returned with it, and the marker keeps the
// scrub owed: erasing again retries it, and so does the next start. Copies of the
// database made by corruption recovery (settings.db.corrupt.<unix>) are kept for
// a week at most (corrupt.go); the copy a channel switch that copies data makes
// is another profile's, and is not touched.
func (s *Store) ErasePluginSettings(pluginID string, current *DeclaredSettings) (EraseResult, error) {
	var result EraseResult
	err := s.persistOperation("settings.Erase", "", pluginID, func() error {
		var eraseErr error
		result, eraseErr = s.erasePluginSettings(pluginID, current)
		return eraseErr
	})
	return result, err
}

func (s *Store) erasePluginSettings(pluginID string, current *DeclaredSettings) (EraseResult, error) {
	if s == nil || s.db == nil {
		return EraseResult{}, ErrUnavailable
	}
	var result EraseResult
	err := s.db.Update(func(tx *bolt.Tx) error {
		var eraseErr error
		result, eraseErr = eraseInTx(tx, pluginID, current)
		return eraseErr
	})
	if err != nil {
		return EraseResult{}, err
	}
	if result.Unreadable {
		s.logger().Warnw(context.Background(), "plugin settings entry could not be decoded; removed whole",
			"pluginID", pluginID)
	}
	// The erase is committed whether or not the scrub works, so the result stands.
	return result, s.scrubPending()
}

// eraseInTx erases the credential-class values of one plugin in the transaction,
// and sets the scrub marker when it destroyed one.
func eraseInTx(tx *bolt.Tx, pluginID string, current *DeclaredSettings) (EraseResult, error) {
	result := EraseResult{Erased: 0, Kept: 0, Basis: EraseBasisNone, Unreadable: false}
	values := tx.Bucket(pluginsBucket)
	schemas, bucketErr := tx.CreateBucketIfNotExists([]byte(pluginSchemasBucketName))
	if bucketErr != nil {
		return result, fmt.Errorf("create plugin schemas bucket: %w", bucketErr)
	}
	key := []byte(pluginID)
	ordinary, basis := ordinaryForErase(tx, pluginID, current)
	result.Basis = basis
	data := values.Get(key)
	if data == nil {
		// Nothing stored: nothing is left for a remembered schema to describe.
		return result, schemas.Delete(key)
	}
	var stored map[string]json.RawMessage
	if decodeErr := json.Unmarshal(data, &stored); decodeErr != nil {
		// What the entry held is unknown, so it may have held a credential.
		result.Unreadable = true
		return result, errors.Join(markScrubPending(tx), values.Delete(key), schemas.Delete(key))
	}
	leaked := false
	for id, raw := range stored {
		if _, isOrdinary := ordinary[id]; isOrdinary {
			result.Kept++
			continue
		}
		delete(stored, id)
		result.Erased++
		leaked = leaked || !isEmptyValue(raw)
	}
	if leaked {
		if markErr := markScrubPending(tx); markErr != nil {
			return result, markErr
		}
	}
	if len(stored) == 0 {
		return result, errors.Join(values.Delete(key), schemas.Delete(key))
	}
	kept, encodeErr := json.Marshal(stored)
	if encodeErr != nil {
		return result, fmt.Errorf("encode plugin settings %q: %w", pluginID, encodeErr)
	}
	return result, values.Put(key, kept)
}

// ordinaryForErase picks what classifies the stored values: the schema this
// session learned, else the one remembered, else nothing.
func ordinaryForErase(tx *bolt.Tx, pluginID string, current *DeclaredSettings) (map[string]struct{}, EraseBasis) {
	if current != nil {
		ordinary := make(map[string]struct{}, len(current.Ordinary))
		for _, id := range current.Ordinary {
			ordinary[id] = struct{}{}
		}
		return ordinary, EraseBasisSession
	}
	if ordinary, ok := rememberedOrdinary(tx, pluginID); ok {
		return ordinary, EraseBasisRemembered
	}
	return nil, EraseBasisNone
}
