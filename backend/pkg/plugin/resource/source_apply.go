package resource

import (
	"strings"
	"sync"
	"time"
	"unsafe"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	resourcepb "github.com/omniviewdev/plugin-sdk/proto/resource/v2"
	"google.golang.org/protobuf/proto"
)

// This independent host safety limit bounds decoded frames and simultaneous
// encoder/decoder scratch. It may reject a wire-valid dense frame; callers
// receive RESOURCE_LIMIT and no observations are truncated.
const maxSourceTransientBytes = 256 << 20

// A member owns one encoded body and immutable admission headers and metadata.
// Demanded graph extraction may shallow-copy these handles under its own budget;
// source and view reference charges never include optional graph ownership.
type sourceMember struct {
	body            []byte
	header          *sourceMemberHeader
	metadata        *resourcev2.ResourceMetadata
	admission       *sourceMemberAdmission
	bodyOutput      int
	size            int
	transient       int
	headerTransient int
	ref             *sourceMemberRef
}

// Frame-local costs keep retained ownership separate from construction scratch.
type sourceMemberCost struct {
	retained  int
	transient int
}

type sourceMemberHeader struct {
	key              string
	reference        resourcev2.ResourceReference
	representation   resourcev2.Representation
	coverage         resourcev2.Coverage
	sourceRevision   *string
	displayName      *string
	documentCoverage resourcev2.DocumentCoverage
}

// Only the host issues this certificate, after validating the complete
// observation against the session's selected binding and attempt.
type sourceMemberAdmission struct {
	generation string
}

// sourceMemberLedger charges immutable member blobs until both the source and
// every in-flight view snapshot release their references.
type sourceMemberLedger struct {
	mu      sync.Mutex
	used    int
	changed chan struct{}
}

func (l *sourceMemberLedger) reserve(size int) bool {
	return l.reserveLimit(size, maxSourceSessionBytes)
}

func (l *sourceMemberLedger) reserveLimit(size, limit int) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if size < 0 || size > limit-l.used {
		return false
	}
	l.used += size
	return true
}

// changes returns a notification closed by the next positive release.
func (l *sourceMemberLedger) changes() <-chan struct{} {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.changed == nil {
		l.changed = make(chan struct{})
	}
	return l.changed
}

func (l *sourceMemberLedger) release(size int) {
	l.mu.Lock()
	l.used -= size
	if size > 0 && l.changed != nil {
		close(l.changed)
		l.changed = nil
	}
	l.mu.Unlock()
}

type sourceTransientLedger struct{ sourceMemberLedger }

func (l *sourceTransientLedger) reserve(size int) bool {
	return l.reserveLimit(size, maxSourceTransientBytes)
}

// whenAvailable returns nil when size fits, or a release notification to retry.
func (l *sourceTransientLedger) whenAvailable(size int) <-chan struct{} {
	l.mu.Lock()
	defer l.mu.Unlock()
	if size >= 0 && size <= maxSourceTransientBytes-l.used {
		return nil
	}
	if l.changed == nil {
		l.changed = make(chan struct{})
	}
	return l.changed
}

type sourceMemberRef struct {
	mu     sync.Mutex
	refs   int
	size   int
	ledger *sourceMemberLedger
}

// attachReserved consumes an already reserved ledger charge.
func (m *sourceMember) attachReserved(ledger *sourceMemberLedger) {
	m.ref = &sourceMemberRef{refs: 1, size: m.size, ledger: ledger}
}

func (m sourceMember) retain() {
	if m.ref == nil {
		return
	}
	m.ref.mu.Lock()
	m.ref.refs++
	m.ref.mu.Unlock()
}

func (m sourceMember) release() {
	if m.ref == nil {
		return
	}
	m.ref.mu.Lock()
	m.ref.refs--
	last := m.ref.refs == 0
	m.ref.mu.Unlock()
	if last {
		m.ref.ledger.release(m.ref.size)
	}
}

// sourceMemberEstimate bounds the encoded body, owned headers and canonical
// key, including small-map buckets and membership/lifetime bookkeeping.
func sourceMemberEstimate(o resourcev2.SourceObservation, limit int) (int, error) {
	size := 1024
	add := func(n, multiplier int) bool {
		if size > limit || n < 0 || n > (limit-size)/multiplier {
			return false
		}
		size += n * multiplier
		return true
	}
	text := func(s string) bool { return add(len(s), 1) }
	optional := func(s *string) bool { return s == nil || text(*s) }
	wireBytes, err := resourcev2.ValueWireSize(o.Record.Body)
	if err != nil {
		return 0, err
	}
	if !add(wireBytes, 1) {
		return 0, resourcev2.NewError("RESOURCE_LIMIT", "Source observation exceeds host limits.")
	}
	r := o.Record
	a := r.Reference.Address
	// JSON escaping can expand the canonical key sixfold. The seventh copy
	// covers the independently owned address strings in the admitted header.
	addressText := func(s string) bool { return add(len(s), 7) }
	ok := size <= limit && addressText(a.Provider) && addressText(a.Authority) &&
		addressText(a.Type) && addressText(a.ID) && add(len(a.Scope), 96) &&
		optional(r.Reference.Incarnation) && text(r.Representation.ID) &&
		text(r.Representation.Revision) &&
		text(r.Coverage.Kind) && text(r.Coverage.Reason) && add(len(r.Coverage.Paths), 16) &&
		optional(r.SourceRevision) && optional(o.DisplayName) &&
		add(len(o.DocumentCoverage.KnownAbsent), 32)
	for _, scope := range a.Scope {
		ok = ok && addressText(scope.Dimension) && addressText(scope.Value)
	}
	for _, path := range r.Coverage.Paths {
		ok = ok && text(path)
	}
	if o.Metadata != nil {
		ok = ok && add(1, 512) && add(len(o.Metadata.Labels), 96)
		for key, val := range o.Metadata.Labels {
			ok = ok && text(key) && text(val)
		}
	}
	for _, path := range o.DocumentCoverage.KnownAbsent {
		ok = ok && add(len(path.Segments), 32)
		for _, segment := range path.Segments {
			ok = ok && optional(segment.Member)
		}
	}
	if !ok {
		return 0, resourcev2.NewError("RESOURCE_LIMIT", "Source observation exceeds host limits.")
	}
	return size, nil
}

// sourceMemberTransientEstimate bounds coexisting protobuf trees, decoded
// values, key construction, and validation scratch before those allocate.
func sourceMemberTransientEstimate(o resourcev2.SourceObservation, limit int) (int, error) {
	size := 1024
	add := func(n, multiplier int) bool {
		if n < 0 || n > (limit-size)/multiplier {
			return false
		}
		size += n * multiplier
		return true
	}
	// Covers sixfold JSON escaping plus simultaneous wire, key and validation
	// copies; ordinary Go string headers share their immutable backing bytes.
	text := func(s string) bool { return add(len(s), 12) }
	optional := func(s *string) bool { return s == nil || text(*s) }
	var value func(resourcev2.Value, int) bool
	value = func(v resourcev2.Value, depth int) bool {
		// A Value is 128 bytes on 64-bit Go. Charge four copies for the
		// received and decoded domain trees, including list storage, plus
		// 768 bytes for protobuf nodes and oneofs, native/JSON validation
		// trees, slice growth, allocator rounding, and concurrent scratch.
		// Map buckets are charged separately below: a bucket has eight keys
		// and eight inline Values, and sparse/growing maps can coexist.
		if depth > resourcev2.MaxValueDepth || !add(1, 1280) || !add(cap(v.List)-len(v.List), 256) ||
			!text(v.Kind) || !text(v.String) || !text(v.Int) || !text(v.Uint) || !text(v.Timestamp) {
			return false
		}
		// Charge two simultaneous eight-slot Value-map buckets plus map
		// headers; entry/protobuf and native JSON storage is charged per node
		// and per map entry below.
		if len(v.Map) != 0 && !add(1, 3072) {
			return false
		}
		for _, child := range v.List {
			if !value(child, depth+1) {
				return false
			}
		}
		for key, child := range v.Map {
			if !add(1, 1024) || !text(key) || !value(child, depth+1) {
				return false
			}
		}
		return true
	}
	r := o.Record
	a := r.Reference.Address
	ok := size <= limit && text(a.Provider) && text(a.Authority) && text(a.Type) && text(a.ID) &&
		add(cap(a.Scope), 256) && optional(r.Reference.Incarnation) &&
		text(r.Representation.ID) && text(r.Representation.Revision) &&
		text(r.Coverage.Kind) && text(r.Coverage.Reason) && add(cap(r.Coverage.Paths), 256) &&
		optional(r.SourceRevision) && optional(o.DisplayName) && value(r.Body, 0) &&
		add(cap(o.DocumentCoverage.KnownAbsent), 256)
	for _, scope := range a.Scope {
		ok = ok && text(scope.Dimension) && text(scope.Value)
	}
	for _, path := range r.Coverage.Paths {
		ok = ok && text(path)
	}
	if o.Metadata != nil {
		ok = ok && add(len(o.Metadata.Labels), 256)
		for key, val := range o.Metadata.Labels {
			ok = ok && text(key) && text(val)
		}
	}
	for _, path := range o.DocumentCoverage.KnownAbsent {
		ok = ok && add(cap(path.Segments), 256)
		for _, segment := range path.Segments {
			ok = ok && optional(segment.Member)
		}
	}
	if !ok {
		return 0, resourcev2.NewError("RESOURCE_LIMIT", "Source observation exceeds host limits.")
	}
	return size, nil
}

// Strings are immutable. Outgoing consumers need new mutable containers and
// optional pointers, not another allocation for admitted string backing data.
func copySourceToken(token *string) *string {
	if token == nil {
		return nil
	}
	value := *token
	return &value
}

func copySourceReference(reference resourcev2.ResourceReference) resourcev2.ResourceReference {
	reference.Address.Scope = append([]resourcev2.ScopeEntry{}, reference.Address.Scope...)
	reference.Incarnation = copySourceToken(reference.Incarnation)
	return reference
}

func cloneSourceToken(token *string) *string {
	if token == nil {
		return nil
	}
	value := strings.Clone(*token)
	return &value
}

func cloneSourceReference(reference resourcev2.ResourceReference) resourcev2.ResourceReference {
	a := &reference.Address
	a.Provider, a.Authority = strings.Clone(a.Provider), strings.Clone(a.Authority)
	a.Type, a.ID = strings.Clone(a.Type), strings.Clone(a.ID)
	scope := make([]resourcev2.ScopeEntry, len(a.Scope))
	for i, entry := range a.Scope {
		scope[i] = resourcev2.ScopeEntry{Dimension: strings.Clone(entry.Dimension), Value: strings.Clone(entry.Value)}
	}
	a.Scope = scope
	reference.Incarnation = cloneSourceToken(reference.Incarnation)
	return reference
}

func cloneSourceCoverage(coverage resourcev2.Coverage) resourcev2.Coverage {
	coverage.Kind, coverage.Reason = strings.Clone(coverage.Kind), strings.Clone(coverage.Reason)
	paths := make([]string, len(coverage.Paths))
	for i, path := range coverage.Paths {
		paths[i] = strings.Clone(path)
	}
	coverage.Paths = paths
	return coverage
}

func cloneSourceDocumentCoverage(coverage resourcev2.DocumentCoverage) resourcev2.DocumentCoverage {
	if len(coverage.KnownAbsent) == 0 {
		return resourcev2.DocumentCoverage{}
	}
	paths := make([]resourcev2.DocumentFieldPath, len(coverage.KnownAbsent))
	for i, path := range coverage.KnownAbsent {
		paths[i].Segments = make([]resourcev2.FieldPathSegment, len(path.Segments))
		for j, segment := range path.Segments {
			paths[i].Segments[j].Member = cloneSourceToken(segment.Member)
			if segment.Index != nil {
				index := *segment.Index
				paths[i].Segments[j].Index = &index
			}
		}
	}
	return resourcev2.DocumentCoverage{KnownAbsent: paths}
}

func cloneSourceMetadata(metadata *resourcev2.ResourceMetadata) *resourcev2.ResourceMetadata {
	if metadata == nil {
		return nil
	}
	cloned := &resourcev2.ResourceMetadata{Labels: make(map[string]string, len(metadata.Labels))}
	for key, value := range metadata.Labels {
		cloned.Labels[strings.Clone(key)] = strings.Clone(value)
	}
	if metadata.CreatedAt != nil {
		created := time.Unix(metadata.CreatedAt.Unix(), int64(metadata.CreatedAt.Nanosecond())).UTC()
		cloned.CreatedAt = &created
	}
	return cloned
}

func makeSourceMember(o resourcev2.SourceObservation, cost sourceMemberCost) (sourceMember, string, error) {
	if _, err := resourcev2.SourceObservationWireSize(o); err != nil {
		return sourceMember{}, "", err
	}
	size := cost.retained
	headerObservation := o
	headerObservation.Record.Body = resourcev2.Value{}
	headerTransient, err := sourceMemberTransientEstimate(headerObservation, maxSourceTransientBytes)
	if err != nil {
		return sourceMember{}, "", err
	}
	p, err := resourcev2.ToProtoValue(o.Record.Body)
	if err != nil {
		return sourceMember{}, "", err
	}
	if proto.Size(p) > size {
		return sourceMember{}, "", resourcev2.NewError("RESOURCE_LIMIT", "Source observation exceeds its reservation.")
	}
	body, err := proto.Marshal(p)
	if err != nil {
		return sourceMember{}, "", err
	}
	// SDK reference conversion preserves canonical scope order and optional
	// tokens. Clone its strings as well, so no frame backing storage survives.
	referenceProto, err := resourcev2.ToProtoResourceReference(o.Record.Reference)
	if err != nil {
		return sourceMember{}, "", err
	}
	reference, err := resourcev2.FromProtoResourceReference(referenceProto)
	if err != nil {
		return sourceMember{}, "", err
	}
	key, err := registry.CanonicalAddressKey(reference.Address)
	if err != nil {
		return sourceMember{}, "", err
	}
	bodyOutput, ok := sourceViewSize(o.Record.Body, maxSourceTransientBytes)
	if !ok {
		return sourceMember{}, "", resourcev2.NewError("RESOURCE_LIMIT", "Source body output exceeds host limits.")
	}
	h := &sourceMemberHeader{
		key: key, reference: cloneSourceReference(reference),
		representation: resourcev2.Representation{
			ID: strings.Clone(o.Record.Representation.ID), Revision: strings.Clone(o.Record.Representation.Revision),
		},
		coverage: cloneSourceCoverage(o.Record.Coverage), sourceRevision: cloneSourceToken(o.Record.SourceRevision),
		displayName: cloneSourceToken(o.DisplayName), documentCoverage: cloneSourceDocumentCoverage(o.DocumentCoverage),
	}
	member := sourceMember{body: body, header: h, metadata: cloneSourceMetadata(o.Metadata), bodyOutput: bodyOutput, size: size, transient: cost.transient, headerTransient: headerTransient}
	if len(body) > size-member.retainedHeaderBytes() {
		return sourceMember{}, "", resourcev2.NewError("RESOURCE_LIMIT", "Source observation exceeds its reservation.")
	}
	return member, key, nil
}

// retainedHeaderBytes includes owned string data, container backing storage,
// and lifetime bookkeeping. Map buckets are conservatively rounded up, rather
// than treating a metadata label as just two string headers.
func (m sourceMember) retainedHeaderBytes() int {
	size := int(unsafe.Sizeof(m)) + int(unsafe.Sizeof(sourceMemberRef{}))
	if m.header == nil {
		return size
	}
	h := m.header
	size += int(unsafe.Sizeof(*h)) + len(h.key)
	token := func(value *string) {
		if value != nil {
			size += int(unsafe.Sizeof(*value)) + len(*value)
		}
	}
	a := h.reference.Address
	size += len(a.Provider) + len(a.Authority) + len(a.Type) + len(a.ID) + len(a.Scope)*int(unsafe.Sizeof(resourcev2.ScopeEntry{}))
	for _, scope := range a.Scope {
		size += len(scope.Dimension) + len(scope.Value)
	}
	token(h.reference.Incarnation)
	size += len(h.representation.ID) + len(h.representation.Revision)
	size += len(h.coverage.Kind) + len(h.coverage.Reason) + len(h.coverage.Paths)*int(unsafe.Sizeof(""))
	for _, path := range h.coverage.Paths {
		size += len(path)
	}
	token(h.sourceRevision)
	token(h.displayName)
	size += len(h.documentCoverage.KnownAbsent) * int(unsafe.Sizeof(resourcev2.DocumentFieldPath{}))
	for _, path := range h.documentCoverage.KnownAbsent {
		size += len(path.Segments) * int(unsafe.Sizeof(resourcev2.FieldPathSegment{}))
		for _, segment := range path.Segments {
			token(segment.Member)
			if segment.Index != nil {
				size += 8
			}
		}
	}
	if m.metadata != nil {
		buckets := 0
		if len(m.metadata.Labels) != 0 {
			buckets = 1
			for len(m.metadata.Labels) > buckets*13/2 {
				buckets *= 2
			}
		}
		size += int(unsafe.Sizeof(*m.metadata)) + 48 + buckets*288
		for key, value := range m.metadata.Labels {
			size += len(key) + len(value)
		}
		if m.metadata.CreatedAt != nil {
			size += int(unsafe.Sizeof(*m.metadata.CreatedAt))
		}
	}
	return size
}

// Materialization is reserved for actual body consumers. Each result owns
// mutable headers and values; neither an emitter nor a reader can change the
// admitted member or another consumer's output.
func decodeSourceBody(member sourceMember) (resourcev2.Value, error) {
	var p resourcepb.Value
	if err := proto.Unmarshal(member.body, &p); err != nil {
		return resourcev2.Value{}, err
	}
	return resourcev2.FromProtoValue(&p)
}

func materializeSourceRecord(member sourceMember) (resourcev2.SourceRecord, error) {
	body, err := decodeSourceBody(member)
	if err != nil {
		return resourcev2.SourceRecord{}, err
	}
	h := member.header
	coverage := h.coverage
	coverage.Paths = append([]string{}, coverage.Paths...)
	return resourcev2.SourceRecord{
		Reference: copySourceReference(h.reference), Body: body,
		Representation: h.representation,
		Coverage:       coverage, SourceRevision: copySourceToken(h.sourceRevision),
	}, nil
}

// sourceFramePreflight accounts for the whole frame before tracker admission.
func sourceFramePreflight(frame resourcev2.SourceFrame) error {
	_, err := sourceFrameTransientEstimate(frame, maxSourceSessionBytes)
	return err
}

func sourceFrameTransientEstimate(frame resourcev2.SourceFrame, limit int) (int, error) {
	size, err := sourceFrameEnvelopeTransientEstimate(frame, limit)
	if err != nil {
		return 0, err
	}
	member := func(o resourcev2.SourceObservation, memberLimit int) bool {
		n, err := sourceMemberTransientEstimate(o, memberLimit)
		if err != nil || n > limit-size {
			return false
		}
		size += n
		return true
	}
	if frame.Snapshot != nil {
		for _, observation := range frame.Snapshot.Observations {
			if !member(observation, defaultSourceStagingBytes) {
				return 0, resourcev2.NewError("RESOURCE_LIMIT", "Source frame exceeds host limits.")
			}
		}
	}
	if frame.Changes != nil {
		for _, change := range frame.Changes.Changes {
			if change.Observation != nil && !member(*change.Observation, limit) {
				return 0, resourcev2.NewError("RESOURCE_LIMIT", "Source frame exceeds host limits.")
			}
		}
	}
	return size, nil
}

// Exclude observation trees so apply can reuse each frame-local member cost.
func sourceFrameEnvelopeTransientEstimate(frame resourcev2.SourceFrame, limit int) (int, error) {
	size := 1024
	add := func(n, multiplier int) bool {
		if n < 0 || n > (limit-size)/multiplier {
			return false
		}
		size += n * multiplier
		return true
	}
	text := func(s string) bool { return add(len(s), 8) }
	optional := func(s *string) bool { return s == nil || text(*s) }
	coverage := func(c resourcev2.SourceCoverage) bool {
		if !text(c.Enumeration) || !text(c.Consistency) || !add(cap(c.Limitations), 256) {
			return false
		}
		for _, item := range c.Limitations {
			if !text(item) {
				return false
			}
		}
		return true
	}
	member := func(o resourcev2.SourceObservation, memberLimit int) bool {
		n, err := sourceMemberTransientEstimate(o, memberLimit)
		return err == nil && add(n, 1)
	}
	ok := text(frame.SessionID) && text(frame.Generation)
	if frame.Begin != nil {
		ok = ok && text(frame.Begin.Mode)
	}
	if frame.Snapshot != nil {
		ok = ok && len(frame.Snapshot.Observations) <= resourcev2.MaxSourceBatchItems &&
			add(cap(frame.Snapshot.Observations), 256)
	}
	if frame.SnapshotEnd != nil {
		ok = ok && coverage(frame.SnapshotEnd.Coverage) && text(frame.SnapshotEnd.Continuity)
	}
	if frame.Changes != nil {
		ok = ok && len(frame.Changes.Changes) <= resourcev2.MaxSourceBatchItems &&
			add(cap(frame.Changes.Changes), 256)
		for _, change := range frame.Changes.Changes {
			ok = ok && text(change.Kind) && optional(change.SourceRevision)
			if change.Reference != nil {
				ok = ok && member(resourcev2.SourceObservation{Record: resourcev2.SourceRecord{Reference: *change.Reference}}, limit)
			}
		}
		if frame.Changes.Coverage != nil {
			ok = ok && coverage(*frame.Changes.Coverage)
		}
	}
	if frame.Reset != nil {
		ok = ok && text(frame.Reset.Reason) && text(frame.Reset.Message)
	}
	if frame.Failed != nil {
		ok = ok && text(frame.Failed.Code) && text(frame.Failed.Message)
	}
	if !ok {
		return 0, resourcev2.NewError("RESOURCE_LIMIT", "Source frame exceeds host limits.")
	}
	return size, nil
}
