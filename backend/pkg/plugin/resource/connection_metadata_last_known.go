package resource

import (
	"bytes"
	"cmp"
	"context"
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
//   - A current entry of an admitted snapshot replaces what was kept for its key. A stale entry of the plugin's own memory
//     replaces it only when it was observed later.
//   - A snapshot that is the plugin's complete answer (completeAnswer) also removes the keys it leaves out: the plugin dropped them,
//     or no longer finds them.
//   - A tombstone, the removal of a connection, and a plugin that no longer lists a connection drop everything kept for it. A
//     plugin that stops, crashes or restarts keeps it; an uninstall erases it.
//
// What is served (lastKnownConnection.serve): the plugin's own entries, and for each kept key the plugin has no entry for, a
// stale entry with the kept value and the time it was observed. A key the plugin says is unavailable is served as the SDK serves a
// failed refresh of a key it has a value for: stale, with the plugin's error.
//
// Only what a host can show as public is kept: a value, or a key, that looks like a credential (devdiag, the redaction the log
// sinks apply) is refused, as is a value past its byte limit. The file holds entries and the times they were observed and nothing
// else: no connection configuration, no credentials.
const (
	// lastKnownStoreName is the file of a plugin's store that holds the entries its connections last answered.
	lastKnownStoreName = "connection-metadata-v1"
	// lastKnownVersion is the version of the file's format; a file of another version is ignored and replaced.
	lastKnownVersion = 1
	// lastKnownDebounce is how long a change waits for others before the file is written.
	lastKnownDebounce = 2 * time.Second
	// lastKnownMaxEntries is the most entries kept for one connection; the ones observed earliest go first.
	lastKnownMaxEntries = 32
	// lastKnownMaxValueBytes is the most bytes of JSON kept for one value; a larger one is not kept.
	lastKnownMaxValueBytes = 8 << 10
	// lastKnownMaxPluginBytes is the most bytes kept for one plugin; the connections observed earliest go first.
	lastKnownMaxPluginBytes = 4 << 20
	// lastKnownMaxFileBytes is the largest file that is read: what lastKnownMaxPluginBytes allows, and the JSON around it.
	lastKnownMaxFileBytes = 2 * lastKnownMaxPluginBytes
	// lastKnownEntryOverhead and lastKnownConnectionOverhead are the bytes of the JSON around an entry and around a connection's
	// entries, counted with each so that the bound on a plugin's bytes bounds its file.
	lastKnownEntryOverhead      = 4
	lastKnownConnectionOverhead = 32

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
// retired epoch never reaches it and the order in which it changes is the order of admission. The disk is read once for a plugin
// (warm, before any lock) and written by one flush at a time for a plugin, from a timer that a change arms and that further changes
// coalesce into (touchLocked, flush); a flush takes its document under mu and writes it after releasing it.
type lastKnownMetadata struct {
	mu      sync.Mutex
	idle    *sync.Cond
	plugins map[string]*lastKnownPlugin
	storeFn func(pluginID string) (*appstate.ScopedRoot, error)
	logger  logging.Logger
	limits  lastKnownLimits
	// debounce is the delay of a write that follows a change; an erasure is written at once.
	debounce time.Duration
	// afterFunc runs f once after d and returns the function that cancels it. It must not run f on the calling goroutine, which
	// holds mu; tests replace it.
	afterFunc func(d time.Duration, f func()) (stop func() bool)
	closed    bool
}

func newLastKnownMetadata(logger logging.Logger, storeFn func(pluginID string) (*appstate.ScopedRoot, error)) *lastKnownMetadata {
	s := &lastKnownMetadata{
		mu:       sync.Mutex{},
		idle:     nil,
		plugins:  make(map[string]*lastKnownPlugin),
		storeFn:  storeFn,
		logger:   logger,
		limits:   lastKnownLimits{entries: lastKnownMaxEntries, valueBytes: lastKnownMaxValueBytes, pluginBytes: lastKnownMaxPluginBytes},
		debounce: lastKnownDebounce,
		afterFunc: func(d time.Duration, f func()) func() bool {
			return time.AfterFunc(d, f).Stop
		},
		closed: false,
	}
	s.idle = sync.NewCond(&s.mu)
	return s
}

// lastKnownPlugin is what is kept for one plugin. Every field but the immutable ones is guarded by store.mu.
type lastKnownPlugin struct {
	store *lastKnownMetadata
	id    string
	// loaded is closed once the file has been read, whether it could be or not.
	loaded chan struct{}
	conns  map[string]*lastKnownConnection
	bytes  int
	// dirty says the file is behind the maps; writing that a flush is between taking its document and finishing; gone that the
	// plugin was uninstalled and nothing may be kept for it or written.
	dirty   bool
	writing bool
	gone    bool
	// stop cancels the timer that is armed for this plugin, whose delay is delay; nil when none is.
	stop  func() bool
	delay time.Duration
}

// lastKnownConnection is what is kept for one connection: its entries, the observations that were refused, so that each is
// refused, and reported, once, and the bytes the entries count for.
type lastKnownConnection struct {
	id      string
	entries map[string]lastKnownEntry
	refused map[string]time.Time
	bytes   int
}

func newLastKnownConnection(id string) *lastKnownConnection {
	return &lastKnownConnection{id: id, entries: make(map[string]lastKnownEntry), refused: make(map[string]time.Time), bytes: 0}
}

// lastKnownEntry is one kept value. The value is a plain JSON tree that nothing mutates after it is kept, so it is shared between
// the maps, the document of a flush and the snapshots that are served; a snapshot is deep-copied before anyone else holds it.
type lastKnownEntry struct {
	value      any
	observedAt time.Time
	size       int
}

// entry is the entry as the host serves it: stale, with the time it was observed, exactly as the SDK serves what a stop left.
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
// plugin removed or no longer reports, and what was kept for it is no longer the last known value of anything.
func completeAnswer(snapshot resourcev2.ConnectionMetadataSnapshot) bool {
	return snapshot.Active && !snapshot.Refreshing && snapshot.LastRefreshError == nil && len(snapshot.Entries) > 0
}

// newLastKnownEntry makes the kept form of a value observed at observed, or says why it is not kept. The key and every string of
// the value are held to the redaction the log sinks apply, and a value of another shape than plain JSON is refused.
func newLastKnownEntry(key string, value any, observed time.Time, valueBytes int) (lastKnownEntry, error) {
	var refused lastKnownEntry
	if devdiag.SensitiveKey(key) {
		return refused, errLastKnownCredential
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return refused, errLastKnownInvalid
	}
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
	kept := lastKnownEntry{value: tree, observedAt: observed, size: 0}
	// Marshalling runs the SDK's validation of an entry: what is kept is what it would admit, and a flush cannot fail on it.
	whole, err := json.Marshal(kept.entry())
	if err != nil {
		return refused, errLastKnownInvalid
	}
	kept.size = len(key) + len(whole) + lastKnownEntryOverhead
	return kept, nil
}

// carriesCredential reports whether a string of the tree looks like a credential, or a member of an object is named for one.
func carriesCredential(node any) bool {
	switch value := node.(type) {
	case string:
		return devdiag.Redact(value) != value
	case []any:
		return slices.ContainsFunc(value, carriesCredential)
	case map[string]any:
		for name, member := range value {
			if devdiag.SensitiveKey(name) || carriesCredential(member) {
				return true
			}
		}
	}
	return false
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
func (c *lastKnownConnection) merge(snapshot resourcev2.ConnectionMetadataSnapshot, limits lastKnownLimits, drops *lastKnownDrops) bool {
	changed := false
	if completeAnswer(snapshot) {
		changed = c.forgetOmitted(snapshot)
	}
	for _, key := range slices.Sorted(maps.Keys(snapshot.Entries)) {
		entry := snapshot.Entries[key]
		if entry.ObservedAt == nil || (entry.State != metadataStateCurrent && entry.State != metadataStateStale) {
			continue
		}
		if c.record(key, entry, limits.valueBytes, drops) {
			changed = true
		}
	}
	if c.trim(limits.entries, drops) {
		changed = true
	}
	c.recount()
	return changed
}

// record keeps the value of a current or stale entry of the plugin as the last known value of key, unless what is kept is the same
// observation, or a stale entry is not later than what is kept. A value that is refused leaves no older value standing in its
// place. It reports whether the kept entries changed.
func (c *lastKnownConnection) record(key string, entry resourcev2.ConnectionMetadataEntry, valueBytes int, drops *lastKnownDrops) bool {
	observed := entry.ObservedAt.UTC()
	if refusedAt, was := c.refused[key]; was && refusedAt.Equal(observed) {
		return false
	}
	prior, known := c.entries[key]
	if known && (prior.observedAt.Equal(observed) || (entry.State == metadataStateStale && !prior.observedAt.Before(observed))) {
		return false
	}
	kept, err := newLastKnownEntry(key, entry.Value, observed, valueBytes)
	if err != nil {
		c.refused[key] = observed
		delete(c.entries, key)
		drops.note(err, key)
		return known
	}
	delete(c.refused, key)
	c.entries[key] = kept
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

// serve returns the entries a reader of snapshot is shown: its own, and the kept ones it has none for, stale.
func (c *lastKnownConnection) serve(snapshot resourcev2.ConnectionMetadataSnapshot) map[string]resourcev2.ConnectionMetadataEntry {
	if len(c.entries) == 0 {
		return snapshot.Entries
	}
	served := make(map[string]resourcev2.ConnectionMetadataEntry, len(snapshot.Entries)+len(c.entries))
	maps.Copy(served, snapshot.Entries)
	for key, kept := range c.entries {
		entry := kept.entry()
		own, reported := snapshot.Entries[key]
		switch {
		case !reported:
			served[key] = entry
		case own.State == metadataStateUnavailable:
			entry.Error = own.Error
			served[key] = entry
		}
	}
	return served
}

// warm returns what is kept for the plugin, reading its file first if this is the first call for it. The read is disk I/O: call
// warm before taking a lock, never under one. Every later call returns at once.
func (s *lastKnownMetadata) warm(pluginID string) *lastKnownPlugin {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	p := s.plugins[pluginID]
	first := p == nil
	if first {
		p = &lastKnownPlugin{
			store: s, id: pluginID, loaded: make(chan struct{}), conns: make(map[string]*lastKnownConnection), bytes: 0,
			dirty: false, writing: false, gone: false, stop: nil, delay: 0,
		}
		s.plugins[pluginID] = p
	}
	s.mu.Unlock()
	if first {
		s.load(p)
	} else {
		<-p.loaded
	}
	return p
}

// load reads the file of p. A file that cannot be read is a copy that starts empty: the next write replaces it.
func (s *lastKnownMetadata) load(p *lastKnownPlugin) {
	defer close(p.loaded)
	conns, err := s.read(p.id)
	if err != nil {
		s.logger.Warnw(context.Background(), "saved connection metadata could not be read; starting without it",
			"pluginID", p.id, "errorClass", telemetryutil.ErrorClass(err))
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if p.gone {
		return
	}
	p.conns = conns
	for _, conn := range conns {
		p.bytes += conn.bytes
	}
}

// read returns what the file of a plugin holds, within the limits, or nothing for a plugin with no file.
func (s *lastKnownMetadata) read(pluginID string) (map[string]*lastKnownConnection, error) {
	conns := make(map[string]*lastKnownConnection)
	root, err := s.storeFn(pluginID)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return conns, nil
		}
		return conns, err
	}
	file, err := root.OpenFile(lastKnownStoreName, os.O_RDONLY, 0)
	if errors.Is(err, fs.ErrNotExist) {
		return conns, nil
	}
	if err != nil {
		return conns, err
	}
	defer h3Close(file, "connection_metadata_store_close")
	data, err := io.ReadAll(io.LimitReader(file, lastKnownMaxFileBytes+1))
	if err != nil {
		return conns, err
	}
	if len(data) > lastKnownMaxFileBytes {
		return conns, errLastKnownFile
	}
	doc, err := decodeLastKnown(data)
	if err != nil {
		return conns, err
	}
	var drops lastKnownDrops
	for id, stored := range doc.Connections {
		conn := newLastKnownConnection(id)
		for key, entry := range stored.Entries {
			// Entries are held to the limits and the redaction again: the file may have been written by another version or by hand.
			if entry.ObservedAt == nil {
				continue
			}
			if kept, keepErr := newLastKnownEntry(key, entry.Value, entry.ObservedAt.UTC(), s.limits.valueBytes); keepErr == nil {
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
	return conns, nil
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

// observe records what an admitted snapshot says and returns the entries to serve in its place. It does no I/O and takes only
// store.mu: it is called inside the controller's pluginsMu, after warm. The drops are for the caller to report once it holds no lock.
func (p *lastKnownPlugin) observe(snapshot resourcev2.ConnectionMetadataSnapshot) (map[string]resourcev2.ConnectionMetadataEntry, lastKnownDrops) {
	var drops lastKnownDrops
	if p == nil {
		return snapshot.Entries, drops
	}
	s := p.store
	s.mu.Lock()
	defer s.mu.Unlock()
	if p.gone {
		return snapshot.Entries, drops
	}
	conn := p.conns[snapshot.ConnectionID]
	if conn == nil {
		if !hasKeepable(snapshot.Entries) {
			return snapshot.Entries, drops
		}
		conn = newLastKnownConnection(snapshot.ConnectionID)
		p.conns[snapshot.ConnectionID] = conn
	}
	before := conn.bytes
	changed := conn.merge(snapshot, s.limits, &drops)
	p.bytes += conn.bytes - before
	if p.bytes > s.limits.pluginBytes {
		drops.evicted += fitLastKnown(p.conns, s.limits.pluginBytes)
		p.bytes = 0
		for _, kept := range p.conns {
			p.bytes += kept.bytes
		}
		changed = true
	}
	if len(conn.entries) == 0 && len(conn.refused) == 0 {
		delete(p.conns, conn.id)
	}
	if changed {
		s.touchLocked(p, s.debounce)
	}
	return conn.serve(snapshot), drops
}

// hasKeepable reports whether an entry of a snapshot is one that is kept.
func hasKeepable(entries map[string]resourcev2.ConnectionMetadataEntry) bool {
	for _, entry := range entries {
		if entry.ObservedAt != nil && (entry.State == metadataStateCurrent || entry.State == metadataStateStale) {
			return true
		}
	}
	return false
}

// forget drops everything kept for a connection that was removed, and writes the file at once.
func (p *lastKnownPlugin) forget(connectionID string) {
	if p == nil {
		return
	}
	s := p.store
	s.mu.Lock()
	defer s.mu.Unlock()
	conn := p.conns[connectionID]
	if p.gone || conn == nil {
		return
	}
	p.bytes -= conn.bytes
	delete(p.conns, connectionID)
	if len(conn.entries) > 0 {
		s.touchLocked(p, 0)
	}
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
	if p.gone {
		return
	}
	changed := false
	for id, conn := range p.conns {
		if _, listed := ids[id]; listed {
			continue
		}
		p.bytes -= conn.bytes
		delete(p.conns, id)
		changed = changed || len(conn.entries) > 0
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

// touchLocked says the file is behind what is kept and arms the write: after delay, unless one is already due sooner. A change
// made while a write is in flight is left to that write's end to schedule. The caller holds mu.
func (s *lastKnownMetadata) touchLocked(p *lastKnownPlugin, delay time.Duration) {
	if p.gone {
		return
	}
	p.dirty = true
	if s.closed || p.writing {
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

// flush writes the file of p if it is behind. At most one flush of a plugin runs at a time, and the document is taken under mu and
// written after it is released, so writes land in the order of the changes they hold and no change waits for the disk.
func (s *lastKnownMetadata) flush(p *lastKnownPlugin) {
	doc, ok := s.begin(p)
	if !ok {
		return
	}
	err := s.write(p.id, doc)
	s.end(p, err)
	switch {
	case err == nil:
	case errors.Is(err, fs.ErrNotExist):
		s.logger.Debugw(context.Background(), "connection metadata was not saved: the plugin has no store", "pluginID", p.id)
	default:
		s.logger.Warnw(context.Background(), "connection metadata could not be saved",
			"pluginID", p.id, "errorClass", telemetryutil.ErrorClass(err))
	}
}

// begin takes the document to write, or reports that there is nothing to write. It waits for a write of the same plugin that is in
// flight first.
func (s *lastKnownMetadata) begin(p *lastKnownPlugin) (lastKnownFile, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for p.writing {
		s.idle.Wait()
	}
	if p.stop != nil {
		p.stop()
		p.stop = nil
	}
	if s.closed || p.gone || !p.dirty {
		return lastKnownFile{Version: 0, Connections: nil}, false
	}
	p.dirty, p.writing = false, true
	return p.documentLocked(), true
}

// end finishes a write. A failed write leaves the file owed, for the next change and the shutdown to try again; a change that came
// in during a write is scheduled as one write.
func (s *lastKnownMetadata) end(p *lastKnownPlugin, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p.writing = false
	s.idle.Broadcast()
	switch {
	case err != nil && errors.Is(err, fs.ErrNotExist):
		// The plugin's directory is gone: nothing is owed to it.
		p.dirty = false
	case err != nil:
		p.dirty = true
	case p.dirty:
		s.touchLocked(p, s.debounce)
	}
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
	root, err := s.storeFn(pluginID)
	if err != nil {
		return err
	}
	if len(doc.Connections) == 0 {
		if err = root.Remove(lastKnownStoreName); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return err
		}
		return nil
	}
	data, err := json.Marshal(doc)
	if err != nil {
		return err
	}
	committed, err := writeStoreFile(root, lastKnownStoreName, data)
	if committed {
		// The rename took effect; what is left unknown is only whether the directory entry reached the disk.
		return nil
	}
	return err
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

// erase drops everything kept for an uninstalled plugin, cancels and awaits its writes so that none lands after the erasure, and
// removes its file. The plugin's directory has normally gone with its store by now, which is the same erasure; a plugin whose
// store is gone has nothing left to remove.
func (s *lastKnownMetadata) erase(pluginID string) error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	p := s.plugins[pluginID]
	if p != nil {
		p.gone = true
		if p.stop != nil {
			p.stop()
			p.stop = nil
		}
		for p.writing {
			s.idle.Wait()
		}
		delete(s.plugins, pluginID)
	}
	s.mu.Unlock()
	if p == nil {
		// Nothing was read or written for it in this run, and its store went with its directory.
		return nil
	}
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

// shutdown writes every file that is behind and stops the timers. The host is quitting: nothing waits on it but the quit.
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
	for _, p := range behind {
		s.flush(p)
	}
	s.close()
}

// close cancels the timers, awaits the writes in flight and refuses to arm more. Changes after it are kept in memory only.
func (s *lastKnownMetadata) close() {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	for _, p := range s.plugins {
		if p.stop != nil {
			p.stop()
			p.stop = nil
		}
		for p.writing {
			s.idle.Wait()
		}
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
