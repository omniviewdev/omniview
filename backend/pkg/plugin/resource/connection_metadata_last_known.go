package resource

import (
	"bytes"
	"cmp"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"maps"
	"os"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/telemetryutil"
	"github.com/omniviewdev/omniview/internal/appstate"
	"github.com/omniviewdev/omniview/internal/devdiag"
	logging "github.com/omniviewdev/plugin-sdk/log"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/omniviewdev/plugin-sdk/pkg/types"
)

// A plugin's backend answers the metadata of a connection after a successful connect, and its SDK keeps the answer in
// memory: a stop turns the current entries stale, and a restart of the plugin forgets them. The host keeps the last answer of
// every plugin's connections itself, in the plugin's store, so that a connection that is not connected, or a host that has just
// started, shows what the connection showed when it was last connected, as stale entries with the time they were observed.
//
// What is kept, and when it changes (lastKnownConnection.merge):
//   - A current entry of an admitted snapshot replaces what was kept for its key; an observation at the time of the kept one
//     replaces it only when its value differs. A stale entry of the plugin's own memory replaces it only when it is later.
//   - A snapshot that is the plugin's complete answer (completeAnswer) also removes the keys it leaves out: the plugin dropped them,
//     or no longer finds them.
//   - A tombstone, the removal or any change of a connection's profile, the SDK clearing a connection whose endpoint or
//     credentials changed (clearedBySDK), and a plugin that no longer lists a connection drop everything kept for it. A plugin
//     that stops, crashes or restarts keeps it; an uninstall erases it.
//
// What is served (lastKnownConnection.serve): the plugin's own entries, and for each kept key the plugin has no entry for, a
// stale entry with the kept value and the time it was observed. A key the plugin says is unavailable is served as the SDK serves a
// failed refresh of a key it has a value for: stale, with the plugin's error. What is served is valid by the SDK's own validation.
//
// What is refused is a heuristic and not a guarantee: a key, a connection ID, a string of a value or a member name of one that
// looks like a credential (devdiag, the redaction the log sinks apply), an object whose name or key member is the name of one,
// and a value past its byte limit are not kept. A secret with no such shape under a harmless name is not found. The file holds
// entries and the times they were observed and nothing else: no connection configuration, no credentials.
const (
	// lastKnownStoreName is the file of a plugin's store that holds the entries its connections last answered.
	lastKnownStoreName = "connection-metadata-v1"
	// lastKnownVersion is the version of the file's format; a file of another version is moved aside and replaced.
	lastKnownVersion = 1
	// lastKnownDebounce is how long a change waits for others before the file is written.
	lastKnownDebounce = 2 * time.Second
	// lastKnownMaxEntries is the most entries kept for one connection; the ones observed earliest go first.
	lastKnownMaxEntries = 32
	// lastKnownMaxValueBytes is the most bytes of JSON kept for one value, which is what the SDK admits for an entry; a larger
	// one is not kept.
	lastKnownMaxValueBytes = 16 << 10
	// lastKnownMaxPluginBytes is the most bytes kept for one plugin; the connections observed earliest go first.
	lastKnownMaxPluginBytes = 4 << 20
	// lastKnownMaxFileBytes is the largest file that is read: what lastKnownMaxPluginBytes allows, and the JSON around it.
	lastKnownMaxFileBytes = 2 * lastKnownMaxPluginBytes
	// lastKnownEntryOverhead and lastKnownConnectionOverhead are the bytes of the JSON around an entry and around a connection's
	// entries, counted with each so that the bound on a plugin's bytes bounds its file.
	lastKnownEntryOverhead      = 4
	lastKnownConnectionOverhead = 32
	// lastKnownQuitWait is how long the quit waits for the writes that are still running: a disk that hangs must not hold it up.
	lastKnownQuitWait = 3 * time.Second
	// lastKnownGeneration is the generation of a snapshot the host serves with kept entries and none of its own: the SDK's
	// validation wants one for every snapshot that holds facts. It is opaque and never sorted, like every generation.
	lastKnownGeneration = "host-last-known"

	metadataStateCurrent     = "current"
	metadataStateStale       = "stale"
	metadataStateUnavailable = "unavailable"
)

var (
	errLastKnownTooLarge   = errors.New("connection metadata value exceeds the byte limit")
	errLastKnownCredential = errors.New("connection metadata looks like a credential")
	errLastKnownInvalid    = errors.New("connection metadata value is not plain JSON")
	errLastKnownFile       = errors.New("connection metadata file is not readable")
)

// lastKnownLimits bounds what is kept: the entries of one connection, the bytes of one value, and the bytes of one plugin.
type lastKnownLimits struct {
	entries     int
	valueBytes  int
	pluginBytes int
}

// lastKnownMetadata is the host's copy of what every plugin's connections last answered. The controller owns one, and every
// method is safe on a nil receiver, which keeps nothing.
//
// Locking: mu is a leaf. It guards the maps and the write bookkeeping and is held for memory only: never across disk I/O, a
// log call, a callback of the controller or a plugin call. Admission calls observe and forget inside the controller's pluginsMu,
// after the epoch, registration and revision fences that decide whether a snapshot is admitted at all, so a snapshot from a
// retired epoch never reaches it and the order in which it changes is the order of admission. What a snapshot would add (its
// encoding, redaction and sizes) is prepared before any lock is taken. A plugin's file is read once (warm, before any lock) and
// written by one flush at a time (the plugin's writeMu, taken before mu and never under it), from a timer that a change arms and
// that further changes coalesce into (touchLocked); a flush takes its document under mu and writes it after releasing it.
type lastKnownMetadata struct {
	mu      sync.Mutex
	plugins map[string]*lastKnownPlugin
	storeFn func(pluginID string) (*appstate.ScopedRoot, error)
	logger  logging.Logger
	limits  lastKnownLimits
	// debounce is the delay of a write that follows a change; an erasure is written at once.
	debounce time.Duration
	// afterFunc runs f once after d and returns the function that cancels it. It must not run f on the calling goroutine, which
	// holds mu; tests replace it.
	afterFunc func(d time.Duration, f func()) (stop func() bool)
	quitWait  time.Duration
	// inflight counts the writes that passed the check for close, which waits for them.
	inflight sync.WaitGroup
	closed   bool
}

func newLastKnownMetadata(logger logging.Logger, storeFn func(pluginID string) (*appstate.ScopedRoot, error)) *lastKnownMetadata {
	return &lastKnownMetadata{
		mu:       sync.Mutex{},
		plugins:  make(map[string]*lastKnownPlugin),
		storeFn:  storeFn,
		logger:   logger,
		limits:   lastKnownLimits{entries: lastKnownMaxEntries, valueBytes: lastKnownMaxValueBytes, pluginBytes: lastKnownMaxPluginBytes},
		debounce: lastKnownDebounce,
		afterFunc: func(d time.Duration, f func()) func() bool {
			return time.AfterFunc(d, f).Stop
		},
		quitWait: lastKnownQuitWait,
		inflight: sync.WaitGroup{},
		closed:   false,
	}
}

// lastKnownPlugin is what is kept for one plugin. Every field but the immutable ones and writeMu is guarded by store.mu.
type lastKnownPlugin struct {
	store *lastKnownMetadata
	id    string
	// writeMu serializes the writes of the file, and its erasure, so that a later write always carries a later document.
	writeMu sync.Mutex

	conns map[string]*lastKnownConnection
	bytes int
	// loaded says the file has been read, or was found missing. Until then nothing is kept or written for the plugin: a file that
	// could not be read is never replaced by a copy that holds only what this run saw. loading is open while a read is in flight,
	// and loadFailed says a read failed, which is reported once.
	loaded     bool
	loading    chan struct{}
	loadFailed bool
	// dirty says the file is behind the maps; gone that the plugin was uninstalled, and nothing may be kept for it or written.
	dirty bool
	gone  bool
	// refusedIDs holds the connections whose ID looks like a credential: nothing is kept for them, and each is reported once.
	refusedIDs map[string]struct{}
	// stop cancels the timer that is armed for the plugin, whose delay is delay.
	stop  func() bool
	delay time.Duration
}

func newLastKnownPlugin(s *lastKnownMetadata, id string) *lastKnownPlugin {
	return &lastKnownPlugin{
		store: s, id: id, writeMu: sync.Mutex{}, conns: make(map[string]*lastKnownConnection), bytes: 0,
		loaded: false, loading: nil, loadFailed: false, dirty: false, gone: false,
		refusedIDs: make(map[string]struct{}), stop: nil, delay: 0,
	}
}

// lastKnownConnection is what is kept for one connection: its entries, the observations that were refused, so that each is
// refused, and reported, once, and the bytes the entries count for.
type lastKnownConnection struct {
	id      string
	entries map[string]lastKnownEntry
	refused map[string]lastKnownRefusal
	bytes   int
}

func newLastKnownConnection(id string) *lastKnownConnection {
	return &lastKnownConnection{id: id, entries: make(map[string]lastKnownEntry), refused: make(map[string]lastKnownRefusal), bytes: 0}
}

// lastKnownRefusal is what was refused for a key: its observation time and the digest of its encoded value.
type lastKnownRefusal struct {
	observed time.Time
	digest   [sha256.Size]byte
}

// lastKnownEntry is one kept value. The value is a plain JSON tree that nothing mutates after it is kept, so it is shared between
// the maps, the document of a flush and the snapshots that are served; a snapshot is deep-copied before anyone else holds it. The
// digest is that of the value's encoding, which tells a changed value from the same observation published again.
type lastKnownEntry struct {
	value      any
	observedAt time.Time
	size       int
	digest     [sha256.Size]byte
}

// entry is the entry as the host serves it: stale, with the time it was observed, exactly as the SDK serves what a stop leaves.
func (e lastKnownEntry) entry() resourcev2.ConnectionMetadataEntry {
	observed := e.observedAt
	return resourcev2.ConnectionMetadataEntry{State: metadataStateStale, Value: e.value, ObservedAt: &observed, Error: nil}
}

// lastKnownDrops counts what one operation left out of the copy, for the one line that says so.
type lastKnownDrops struct {
	tooLarge   int
	credential int
	invalid    int
	evicted    int
	// key is the first key whose value was refused.
	key string
}

func (d *lastKnownDrops) note(err error, key string) {
	switch {
	case errors.Is(err, errLastKnownTooLarge):
		d.tooLarge++
	case errors.Is(err, errLastKnownCredential):
		d.credential++
	default:
		d.invalid++
	}
	if d.key == "" {
		d.key = key
	}
}

func (d lastKnownDrops) any() bool { return d.tooLarge+d.credential+d.invalid+d.evicted > 0 }

// lastKnownFile is the file: the entries of each connection, written as the host serves them (stale), keyed by connection and
// by metadata key. Entries are the SDK's own type, so the file is read back through the SDK's validation of an entry.
type lastKnownFile struct {
	Version     int                                `json:"version"`
	Connections map[string]lastKnownConnectionFile `json:"connections"`
}

type lastKnownConnectionFile struct {
	Entries map[string]resourcev2.ConnectionMetadataEntry `json:"entries"`
}

// completeAnswer reports whether snapshot is the plugin's complete answer for its connection: the connection is active, no acquisition
// is running or has failed, and there are entries, which only an acquisition produces. A key such an answer leaves out is one the
// plugin removed or no longer reports, and what was kept for it is no longer the last known value of anything. The SDK publishes an
// active snapshot with no entries at every connect, before its acquisition, which looks the same and is not one; so an answer with
// no entries at all does not drop what was kept.
func completeAnswer(snapshot resourcev2.ConnectionMetadataSnapshot) bool {
	return snapshot.Active && !snapshot.Refreshing && snapshot.LastRefreshError == nil && len(snapshot.Entries) > 0
}

// clearedBySDK reports whether snapshot is what the SDK publishes when it clears a connection's facts on purpose, because its
// endpoint or credentials changed: inactive, with no generation and no entries, after one of a generation. A stop keeps the
// generation and the entries, and the inventory snapshot of a plugin that has just started has no predecessor. The generation
// the host serves for kept entries alone is not the SDK's.
func clearedBySDK(previous *resourcev2.ConnectionMetadataSnapshot, snapshot resourcev2.ConnectionMetadataSnapshot) bool {
	return previous != nil && previous.Generation != "" && previous.Generation != lastKnownGeneration &&
		!snapshot.Active && snapshot.Generation == "" && len(snapshot.Entries) == 0
}

// newLastKnownEntry makes the kept form of a value observed at observed, or says why it is not kept. The key and every string of
// the value are held to the redaction the log sinks apply, and a value of another shape than plain JSON is refused. The entry that
// comes back with an error carries the digest of the value, for the memory of what was refused.
func newLastKnownEntry(key string, value any, observed time.Time, valueBytes int) (lastKnownEntry, error) {
	var refused lastKnownEntry
	if devdiag.SensitiveKey(key) {
		return refused, errLastKnownCredential
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return refused, errLastKnownInvalid
	}
	refused.digest = sha256.Sum256(encoded)
	if len(encoded) > valueBytes {
		return refused, errLastKnownTooLarge
	}
	// The tree read back is the copy that is kept: plain JSON values and no reference to the plugin's.
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.UseNumber()
	var tree any
	if err = decoder.Decode(&tree); err != nil {
		return refused, errLastKnownInvalid
	}
	if carriesCredential(tree) {
		return refused, errLastKnownCredential
	}
	kept := lastKnownEntry{value: tree, observedAt: observed, size: 0, digest: refused.digest}
	// Marshalling runs the SDK's validation of an entry: what is kept is what it would admit, and a flush cannot fail on it.
	whole, err := json.Marshal(kept.entry())
	if err != nil {
		return refused, errLastKnownInvalid
	}
	kept.size = len(key) + len(whole) + lastKnownEntryOverhead
	return kept, nil
}

// carriesCredential reports whether a string of the tree looks like a credential, a member of an object is named for one, or an
// object names one in its name or key member (the shape of a list of environment variables).
func carriesCredential(node any) bool {
	switch value := node.(type) {
	case string:
		return devdiag.Redact(value) != value
	case []any:
		return slices.ContainsFunc(value, carriesCredential)
	case map[string]any:
		for _, member := range [...]string{"name", "key"} {
			if label, ok := value[member].(string); ok && devdiag.SensitiveKey(label) {
				return true
			}
		}
		for name, member := range value {
			if devdiag.SensitiveKey(name) || carriesCredential(member) {
				return true
			}
		}
	}
	return false
}

// lastKnownCandidate is what an entry of a snapshot becomes when it is kept, or why it is not.
type lastKnownCandidate struct {
	entry lastKnownEntry
	err   error
}

// lastKnownPrepared is what a snapshot would add to the copy: a candidate for each of its current and stale entries, and whether
// its connection may be kept at all. It is a function of the snapshot alone, made before any lock is taken.
type lastKnownPrepared struct {
	idRefused  bool
	candidates map[string]lastKnownCandidate
}

func (s *lastKnownMetadata) prepare(snapshot resourcev2.ConnectionMetadataSnapshot) lastKnownPrepared {
	prepared := lastKnownPrepared{idRefused: false, candidates: make(map[string]lastKnownCandidate, len(snapshot.Entries))}
	if s == nil {
		return prepared
	}
	// The ID is written as the key of the connection's entries.
	prepared.idRefused = devdiag.Redact(snapshot.ConnectionID) != snapshot.ConnectionID
	if prepared.idRefused {
		return prepared
	}
	for key, entry := range snapshot.Entries {
		if entry.ObservedAt == nil || (entry.State != metadataStateCurrent && entry.State != metadataStateStale) {
			continue
		}
		kept, err := newLastKnownEntry(key, entry.Value, entry.ObservedAt.UTC(), s.limits.valueBytes)
		prepared.candidates[key] = lastKnownCandidate{entry: kept, err: err}
	}
	return prepared
}

// forgetOmitted drops the kept entries of the keys a complete answer leaves out, and the memory of the observations that were
// refused for them, so that the memory is never larger than what the plugin publishes. It reports whether an entry went.
func (c *lastKnownConnection) forgetOmitted(snapshot resourcev2.ConnectionMetadataSnapshot) bool {
	changed := false
	for key := range c.entries {
		if _, reported := snapshot.Entries[key]; !reported {
			delete(c.entries, key)
			changed = true
		}
	}
	for key := range c.refused {
		if _, reported := snapshot.Entries[key]; !reported {
			delete(c.refused, key)
		}
	}
	return changed
}

// merge applies one admitted snapshot to what is kept for its connection and reports whether anything changed.
func (c *lastKnownConnection) merge(snapshot resourcev2.ConnectionMetadataSnapshot, prepared lastKnownPrepared, limits lastKnownLimits, drops *lastKnownDrops) bool {
	changed := false
	if completeAnswer(snapshot) {
		changed = c.forgetOmitted(snapshot)
	}
	for _, key := range slices.Sorted(maps.Keys(prepared.candidates)) {
		if c.record(key, snapshot.Entries[key], prepared.candidates[key], drops) {
			changed = true
		}
	}
	if c.trim(limits.entries, drops) {
		changed = true
	}
	c.recount()
	return changed
}

// record keeps the value of a current or stale entry of the plugin as the last known value of key, unless what is kept is the
// same observation, or a stale entry is earlier than what is kept. An observation at the time of the kept one replaces it when
// its value differs. A value that is refused leaves no older value standing in its place. It reports whether the kept entries
// changed.
func (c *lastKnownConnection) record(key string, entry resourcev2.ConnectionMetadataEntry, candidate lastKnownCandidate, drops *lastKnownDrops) bool {
	observed := entry.ObservedAt.UTC()
	if candidate.err != nil {
		refusal := lastKnownRefusal{observed: observed, digest: candidate.entry.digest}
		if prior, was := c.refused[key]; was && prior.observed.Equal(observed) && prior.digest == refusal.digest {
			return false
		}
		c.refused[key] = refusal
		_, known := c.entries[key]
		delete(c.entries, key)
		drops.note(candidate.err, key)
		return known
	}
	delete(c.refused, key)
	if prior, known := c.entries[key]; known {
		if prior.observedAt.Equal(observed) {
			if prior.digest == candidate.entry.digest {
				return false
			}
		} else if entry.State == metadataStateStale && prior.observedAt.After(observed) {
			return false
		}
	}
	c.entries[key] = candidate.entry
	return true
}

// trim drops the entries observed earliest until at most limit are kept.
func (c *lastKnownConnection) trim(limit int, drops *lastKnownDrops) bool {
	if len(c.entries) <= limit {
		return false
	}
	keys := slices.SortedFunc(maps.Keys(c.entries), func(a, b string) int {
		return cmp.Or(c.entries[a].observedAt.Compare(c.entries[b].observedAt), strings.Compare(a, b))
	})
	for _, key := range keys[:len(keys)-limit] {
		delete(c.entries, key)
		drops.evicted++
	}
	return true
}

func (c *lastKnownConnection) recount() {
	c.bytes = 0
	if len(c.entries) == 0 {
		return
	}
	c.bytes = len(c.id) + lastKnownConnectionOverhead
	for _, kept := range c.entries {
		c.bytes += kept.size
	}
}

// latest is the time of the latest observation kept for the connection: how recently it was used.
func (c *lastKnownConnection) latest() time.Time {
	var latest time.Time
	for _, kept := range c.entries {
		if kept.observedAt.After(latest) {
			latest = kept.observedAt
		}
	}
	return latest
}

// serve returns the snapshot a reader is shown: the plugin's own entries, and for each kept key it has none for, a stale entry.
// A snapshot that holds facts and no generation of the SDK's gets the host's. The result is valid by the SDK's own validation;
// a result that would not be (more entries or bytes than the SDK admits) is the plugin's snapshot as it came.
func (c *lastKnownConnection) serve(snapshot resourcev2.ConnectionMetadataSnapshot) resourcev2.ConnectionMetadataSnapshot {
	served := make(map[string]resourcev2.ConnectionMetadataEntry, len(snapshot.Entries)+len(c.entries))
	maps.Copy(served, snapshot.Entries)
	added := false
	for key, kept := range c.entries {
		entry := kept.entry()
		if own, reported := snapshot.Entries[key]; reported {
			if own.State != metadataStateUnavailable {
				continue
			}
			entry.Error = own.Error
		}
		served[key] = entry
		added = true
	}
	if !added {
		return snapshot
	}
	candidate := snapshot
	candidate.Entries = served
	if candidate.Generation == "" {
		candidate.Generation = lastKnownGeneration
	}
	if resourcev2.ValidateConnectionMetadataSnapshot(candidate) != nil {
		return snapshot
	}
	return candidate
}

// warm returns what is kept for the plugin, reading its file first if that has not succeeded yet. A read that fails leaves the
// plugin unloaded, so that nothing is kept or written for it and the file is never replaced by a copy that holds only what this
// run saw; the next call reads again. The read is disk I/O: call warm before taking a lock, never under one. A plugin that is
// loaded, or gone, is returned at once.
func (s *lastKnownMetadata) warm(pluginID string) *lastKnownPlugin {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	p := s.plugins[pluginID]
	if p == nil {
		p = newLastKnownPlugin(s, pluginID)
		s.plugins[pluginID] = p
	}
	if p.loaded || p.gone {
		s.mu.Unlock()
		return p
	}
	if reading := p.loading; reading != nil {
		s.mu.Unlock()
		<-reading
		return p
	}
	p.loading = make(chan struct{})
	s.mu.Unlock()

	conns, err := s.read(pluginID)

	s.mu.Lock()
	close(p.loading)
	p.loading = nil
	report := false
	switch {
	case err != nil:
		report, p.loadFailed = !p.loadFailed, true
	case !p.gone:
		p.conns, p.loaded = conns, true
		p.bytes = p.sizeLocked()
	}
	s.mu.Unlock()
	if report {
		s.logger.Warnw(context.Background(), "saved connection metadata could not be read; nothing is kept or saved for the plugin until it can be",
			"pluginID", pluginID, "errorClass", telemetryutil.ErrorClass(err))
	}
	return p
}

// read returns what the file of a plugin holds, within the limits, or nothing for a plugin with no file. A file that is not what
// this version wrote is moved aside, and counts as empty; any other failure is returned.
func (s *lastKnownMetadata) read(pluginID string) (map[string]*lastKnownConnection, error) {
	root, err := s.storeFn(pluginID)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return map[string]*lastKnownConnection{}, nil
		}
		return nil, err
	}
	sweepLastKnownTemporaries(root)
	data, found, err := readLastKnownFile(root)
	if err != nil {
		return nil, err
	}
	if !found {
		return map[string]*lastKnownConnection{}, nil
	}
	doc, err := decodeLastKnown(data)
	if len(data) > lastKnownMaxFileBytes {
		err = errLastKnownFile
	}
	if err != nil {
		return map[string]*lastKnownConnection{}, s.quarantine(root, pluginID, err)
	}
	return s.adoptFile(doc), nil
}

// quarantine moves the file aside, as the activity history is, so that it is never overwritten in place.
func (s *lastKnownMetadata) quarantine(root *appstate.ScopedRoot, pluginID string, cause error) error {
	name, err := root.Quarantine(lastKnownStoreName)
	if err != nil {
		return err
	}
	s.logger.Warnw(context.Background(), "saved connection metadata could not be read; moved aside and starting without it",
		"pluginID", pluginID, "quarantine", name, "errorClass", telemetryutil.ErrorClass(cause))
	return nil
}

func readLastKnownFile(root *appstate.ScopedRoot) ([]byte, bool, error) {
	file, err := root.OpenFile(lastKnownStoreName, os.O_RDONLY, 0)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	data, err := io.ReadAll(io.LimitReader(file, lastKnownMaxFileBytes+1))
	// Closed before any rename of the file: Windows refuses to move one that is open.
	h3Close(file, "connection_metadata_store_close")
	if err != nil {
		return nil, false, err
	}
	return data, true, nil
}

// sweepLastKnownTemporaries removes what a write that was cut short left in the plugin's store. It runs while the plugin is
// loaded, before any write of this process for it.
func sweepLastKnownTemporaries(root *appstate.ScopedRoot) {
	entries, err := root.ReadDir(".")
	if err != nil {
		return
	}
	for _, entry := range entries {
		if name := entry.Name(); strings.HasPrefix(name, lastKnownStoreName+".") && strings.HasSuffix(name, ".tmp") {
			_ = root.Remove(name)
		}
	}
}

// adoptFile makes the connections of a file. Entries are held to the limits and the redaction again: the file may have been
// written by another version or by hand.
func (s *lastKnownMetadata) adoptFile(doc lastKnownFile) map[string]*lastKnownConnection {
	conns := make(map[string]*lastKnownConnection, len(doc.Connections))
	var drops lastKnownDrops
	for id, stored := range doc.Connections {
		if devdiag.Redact(id) != id {
			continue
		}
		conn := newLastKnownConnection(id)
		for key, entry := range stored.Entries {
			if entry.ObservedAt == nil {
				continue
			}
			if kept, err := newLastKnownEntry(key, entry.Value, entry.ObservedAt.UTC(), s.limits.valueBytes); err == nil {
				conn.entries[key] = kept
			}
		}
		conn.trim(s.limits.entries, &drops)
		conn.recount()
		if len(conn.entries) > 0 {
			conns[id] = conn
		}
	}
	fitLastKnown(conns, s.limits.pluginBytes)
	return conns
}

// decodeLastKnown reads the document of a file: one JSON object of the current version with no field of another.
func decodeLastKnown(data []byte) (lastKnownFile, error) {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var doc lastKnownFile
	if err := decoder.Decode(&doc); err != nil {
		return lastKnownFile{}, err
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) || doc.Version != lastKnownVersion {
		return lastKnownFile{}, errLastKnownFile
	}
	return doc, nil
}

// fitLastKnown drops the connections observed earliest from conns until what is kept for them is within limit bytes, and reports
// how many entries went.
func fitLastKnown(conns map[string]*lastKnownConnection, limit int) int {
	total := 0
	for _, conn := range conns {
		total += conn.bytes
	}
	dropped := 0
	for total > limit && len(conns) > 0 {
		var oldest *lastKnownConnection
		for _, conn := range conns {
			if oldest == nil || conn.latest().Before(oldest.latest()) || (conn.latest().Equal(oldest.latest()) && conn.id < oldest.id) {
				oldest = conn
			}
		}
		total -= oldest.bytes
		dropped += len(oldest.entries)
		clear(oldest.entries)
		oldest.bytes = 0
		delete(conns, oldest.id)
	}
	return dropped
}

// sizeLocked is the bytes kept for the plugin. The caller holds mu.
func (p *lastKnownPlugin) sizeLocked() int {
	total := 0
	for _, conn := range p.conns {
		total += conn.bytes
	}
	return total
}

// observe records what an admitted snapshot says and returns the snapshot to serve in its place; cleared says the SDK cleared the
// connection's facts on purpose (clearedBySDK), so that what was kept goes first. It does no I/O and takes only store.mu: it is
// called inside the controller's pluginsMu, after warm. The drops are for the caller to report once it holds no lock. A plugin
// that is not loaded, or is gone, keeps nothing.
func (p *lastKnownPlugin) observe(snapshot resourcev2.ConnectionMetadataSnapshot, prepared lastKnownPrepared, cleared bool) (resourcev2.ConnectionMetadataSnapshot, lastKnownDrops) {
	var drops lastKnownDrops
	if p == nil {
		return snapshot, drops
	}
	s := p.store
	s.mu.Lock()
	defer s.mu.Unlock()
	if p.gone || !p.loaded {
		return snapshot, drops
	}
	id := snapshot.ConnectionID
	if cleared && p.forgetLocked(id) {
		s.touchLocked(p, 0)
	}
	if prepared.idRefused {
		if _, reported := p.refusedIDs[id]; !reported {
			p.refusedIDs[id] = struct{}{}
			drops.credential++
			drops.key = "(connection ID)"
		}
		return snapshot, drops
	}
	conn := p.conns[id]
	if conn == nil {
		conn = newLastKnownConnection(id)
		p.conns[id] = conn
	}
	before := conn.bytes
	changed := conn.merge(snapshot, prepared, s.limits, &drops)
	p.bytes += conn.bytes - before
	if p.bytes > s.limits.pluginBytes {
		drops.evicted += fitLastKnown(p.conns, s.limits.pluginBytes)
		p.bytes = p.sizeLocked()
		changed = true
	}
	if len(conn.entries) == 0 && len(conn.refused) == 0 {
		delete(p.conns, id)
	}
	if changed {
		s.touchLocked(p, s.debounce)
	}
	return conn.serve(snapshot), drops
}

// forget drops everything kept for a connection that was removed or changed, and writes the file at once.
func (p *lastKnownPlugin) forget(connectionID string) {
	if p == nil {
		return
	}
	s := p.store
	s.mu.Lock()
	defer s.mu.Unlock()
	if p.gone || !p.loaded {
		return
	}
	if p.forgetLocked(connectionID) {
		s.touchLocked(p, 0)
	}
}

// forgetLocked drops everything kept for a connection and reports whether it held entries. The caller holds mu.
func (p *lastKnownPlugin) forgetLocked(connectionID string) bool {
	delete(p.refusedIDs, connectionID)
	conn := p.conns[connectionID]
	if conn == nil {
		return false
	}
	p.bytes -= conn.bytes
	delete(p.conns, connectionID)
	return len(conn.entries) > 0
}

// retain drops what is kept for every connection that is not in ids: the plugin has listed its connections and these are not among
// them, so they were removed while it was not running.
func (p *lastKnownPlugin) retain(ids map[string]struct{}) {
	if p == nil {
		return
	}
	s := p.store
	s.mu.Lock()
	defer s.mu.Unlock()
	if p.gone || !p.loaded {
		return
	}
	changed := false
	for id := range p.conns {
		if _, listed := ids[id]; !listed && p.forgetLocked(id) {
			changed = true
		}
	}
	for id := range p.refusedIDs {
		if _, listed := ids[id]; !listed {
			delete(p.refusedIDs, id)
		}
	}
	if changed {
		s.touchLocked(p, s.debounce)
	}
}

// connectionIDs is the set of the IDs of connections.
func connectionIDs(connections []types.Connection) map[string]struct{} {
	ids := make(map[string]struct{}, len(connections))
	for _, connection := range connections {
		ids[connection.ID] = struct{}{}
	}
	return ids
}

// touchLocked says the file is behind what is kept and arms the write: after delay, unless one is already due sooner, so that an
// erasure that comes while a write is in flight is written at once after it. Nothing is armed for a plugin that is gone or not
// loaded, or once the copy is closed. The caller holds mu.
func (s *lastKnownMetadata) touchLocked(p *lastKnownPlugin, delay time.Duration) {
	if p.gone || !p.loaded {
		return
	}
	p.dirty = true
	if s.closed {
		return
	}
	if p.stop != nil {
		if delay >= p.delay {
			return
		}
		p.stop()
	}
	p.delay = delay
	p.stop = s.afterFunc(delay, func() { s.flush(p) })
}

// flush writes the file of p if it is behind, and cancels the timer that was armed for it, whoever calls. At most one flush of a
// plugin runs at a time, and the document is taken under mu and written after it is released, so writes land in the order of the
// changes they hold and no change waits for the disk.
func (s *lastKnownMetadata) flush(p *lastKnownPlugin) {
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	s.mu.Lock()
	if p.stop != nil {
		p.stop()
		p.stop = nil
	}
	if s.closed || p.gone || !p.loaded || !p.dirty {
		s.mu.Unlock()
		return
	}
	p.dirty = false
	doc := p.documentLocked()
	s.inflight.Add(1)
	s.mu.Unlock()
	defer s.inflight.Done()

	err := s.write(p.id, doc)
	if err == nil {
		return
	}
	if errors.Is(err, fs.ErrNotExist) {
		// The plugin's directory is gone: nothing is owed to it.
		s.logger.Debugw(context.Background(), "connection metadata was not saved: the plugin has no store", "pluginID", p.id)
		return
	}
	// A failed write leaves the file owed, for the next change and the quit to try again.
	s.mu.Lock()
	p.dirty = true
	s.mu.Unlock()
	s.logger.Warnw(context.Background(), "connection metadata could not be saved", "pluginID", p.id, "errorClass", telemetryutil.ErrorClass(err))
}

// documentLocked is the file's content for what is kept. The caller holds mu; the values it shares are never mutated.
func (p *lastKnownPlugin) documentLocked() lastKnownFile {
	doc := lastKnownFile{Version: lastKnownVersion, Connections: make(map[string]lastKnownConnectionFile, len(p.conns))}
	for id, conn := range p.conns {
		if len(conn.entries) == 0 {
			continue
		}
		entries := make(map[string]resourcev2.ConnectionMetadataEntry, len(conn.entries))
		for key, kept := range conn.entries {
			entries[key] = kept.entry()
		}
		doc.Connections[id] = lastKnownConnectionFile{Entries: entries}
	}
	return doc
}

// write puts doc in the plugin's store: through the profile store's atomic replacement, or, when nothing is kept, by removing the file.
func (s *lastKnownMetadata) write(pluginID string, doc lastKnownFile) error {
	if len(doc.Connections) == 0 {
		return s.removeFile(pluginID)
	}
	root, err := s.storeFn(pluginID)
	if err != nil {
		return err
	}
	data, err := json.Marshal(doc)
	if err != nil {
		return err
	}
	if committed, writeErr := writeStoreFile(root, lastKnownStoreName, data); !committed {
		return writeErr
	}
	// The rename took effect; what is left unknown is only whether the directory entry reached the disk.
	return nil
}

// removeFile removes the file of a plugin. A plugin whose store is gone has nothing left to remove.
func (s *lastKnownMetadata) removeFile(pluginID string) error {
	root, err := s.storeFn(pluginID)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return err
	}
	if err = root.Remove(lastKnownStoreName); err != nil && !errors.Is(err, fs.ErrNotExist) && !errors.Is(err, os.ErrClosed) {
		return err
	}
	return nil
}

// report says in one line what an admission left out of the copy. The caller holds no lock.
func (s *lastKnownMetadata) report(pluginID string, drops lastKnownDrops) {
	if s == nil || !drops.any() {
		return
	}
	s.logger.Warnw(context.Background(), "connection metadata values were left out of the copy kept for the next start",
		"pluginID", pluginID, "tooLarge", drops.tooLarge, "credentialShaped", drops.credential, "invalid", drops.invalid,
		"evicted", drops.evicted, "key", drops.key)
}

// erase drops everything kept for an uninstalled plugin and removes its file. The plugin stays in the map, marked gone, until
// the file is removed, so that nothing reads the file back in the meantime; its pending write is cancelled, and a write in flight
// ends first. A plugin this run never used has nothing in memory, and its file went with its directory.
func (s *lastKnownMetadata) erase(pluginID string) error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	p := s.plugins[pluginID]
	if p == nil {
		s.mu.Unlock()
		return nil
	}
	p.gone = true
	clear(p.conns)
	clear(p.refusedIDs)
	p.bytes = 0
	if p.stop != nil {
		p.stop()
		p.stop = nil
	}
	s.mu.Unlock()

	p.writeMu.Lock()
	err := s.removeFile(pluginID)
	p.writeMu.Unlock()

	s.mu.Lock()
	if s.plugins[pluginID] == p {
		delete(s.plugins, pluginID)
	}
	s.mu.Unlock()
	return err
}

// settle writes what is pending for a plugin whose backend has stopped, and cancels its timer, before the stop returns: the
// plugin's store is about to be moved or removed by an update or an uninstall, and a file that is held open under it, by a write
// that fires later, fails that on Windows. Admissions of the stopped registration are refused by then, so nothing is written for
// the plugin until it starts again.
func (s *lastKnownMetadata) settle(pluginID string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	p := s.plugins[pluginID]
	s.mu.Unlock()
	if p != nil {
		s.flush(p)
	}
}

// shutdown writes every file that is behind and closes the copy. The host is quitting: nothing waits on it but the quit, and the
// quit waits for it for a few seconds at most.
func (s *lastKnownMetadata) shutdown() {
	if s == nil {
		return
	}
	s.mu.Lock()
	var behind []*lastKnownPlugin
	for _, p := range s.plugins {
		if p.dirty {
			behind = append(behind, p)
		}
	}
	s.mu.Unlock()
	s.within(func() {
		for _, p := range behind {
			s.flush(p)
		}
	})
	s.close()
}

// close cancels the timers, refuses to arm more, and waits for the writes in flight, for a few seconds at most. Changes after it
// are kept in memory only.
func (s *lastKnownMetadata) close() {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.closed = true
	for _, p := range s.plugins {
		if p.stop != nil {
			p.stop()
			p.stop = nil
		}
	}
	s.mu.Unlock()
	s.within(s.inflight.Wait)
}

// within runs f and waits for it for at most quitWait: a disk that hangs must not hold up the quit.
func (s *lastKnownMetadata) within(f func()) {
	done := make(chan struct{})
	go func() {
		defer close(done)
		f()
	}()
	timer := time.NewTimer(s.quitWait)
	defer timer.Stop()
	select {
	case <-done:
	case <-timer.C:
		s.logger.Warnw(context.Background(), "connection metadata writes were still running at quit; the quit did not wait for them")
	}
}

// lastKnownOf is what the host kept for a plugin that supports metadata, read from disk first if this is the first call for it, or
// nil for a plugin that does not support it, which keeps nothing. Call it with no lock held.
func (c *controller) lastKnownOf(pluginID string) *lastKnownPlugin {
	c.pluginsMu.RLock()
	state := c.plugins[pluginID]
	supported := state != nil && state.features.Has(resourcev2.FeatureConnectionMetadata)
	c.pluginsMu.RUnlock()
	if !supported {
		return nil
	}
	return c.lastKnown.warm(pluginID)
}

// retainLastKnownMetadata drops what the host kept for a connection that a plugin that supports metadata no longer lists: it was
// removed while the plugin was not running, and no tombstone told the host. It is given the plugin's complete list, once the load
// that produced it holds no lock. That list is the slice the controller published as its own, which a start or a stop of a
// connection writes in place under connsMu, so its IDs are read under connsMu; a plugin that keeps nothing never reads it.
func (c *controller) retainLastKnownMetadata(pluginID string, listed []types.Connection) {
	known := c.lastKnownOf(pluginID)
	if known == nil {
		return
	}
	c.connsMu.RLock()
	ids := connectionIDs(listed)
	c.connsMu.RUnlock()
	known.retain(ids)
}
