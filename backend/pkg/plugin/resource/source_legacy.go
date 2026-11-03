package resource

import (
	"context"
	"io"
	"reflect"
	"strings"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	resourceplugin "github.com/omniviewdev/plugin-sdk/pkg/resource/v2/plugin"
	"google.golang.org/protobuf/proto"
)

// newLegacySourceOpener adapts finite P45 operations. The descriptor must be
// the immutable catalog descriptor admitted for this source generation.
func newLegacySourceOpener(provider any, descriptor resourcev2.ResourceType) resourcev2.SourceStreamOpener {
	return &legacySourceOpener{provider: provider, descriptor: descriptor}
}

type legacySourceOpener struct {
	provider   any
	descriptor resourcev2.ResourceType
}

type legacySourceResult struct {
	frame resourcev2.SourceFrame
	err   error
}

type legacySourceStream struct {
	cancel  context.CancelFunc
	ctx     context.Context
	results <-chan legacySourceResult
}

func (s *legacySourceStream) Close() { s.cancel() }
func (s *legacySourceStream) Recv() (resourcev2.SourceFrame, error) {
	select {
	case <-s.ctx.Done():
		return resourcev2.SourceFrame{}, s.ctx.Err()
	case result, ok := <-s.results:
		if !ok {
			return resourcev2.SourceFrame{}, io.EOF
		}
		return result.frame, result.err
	}
}

func (o *legacySourceOpener) OpenSourceStream(ctx context.Context, request resourcev2.SourceOpenRequest) (resourcev2.SourceStream, error) {
	if err := resourcev2.ValidateSourceOpenRequest(request); err != nil {
		return nil, err
	}
	if request.Mode != resourcev2.SourceModeSnapshot {
		return nil, resourcev2.NewError("UNSUPPORTED", "Legacy sources support snapshots only.")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	switch request.Acquisition.Kind {
	case resourcev2.SourceAcquisitionEnumerate:
		if _, ok := o.provider.(resourcev2.Enumerator); !ok {
			return nil, resourcev2.NewError("UNSUPPORTED", "Enumeration is not supported.")
		}
	case resourcev2.SourceAcquisitionNativeQuery:
		if _, ok := o.provider.(resourcev2.NativeQuerier); !ok {
			return nil, resourcev2.NewError("UNSUPPORTED", "Native query is not supported.")
		}
		if err := resourcev2.ValidateNativeQueryInput(o.descriptor, resourcev2.NativeQueryRequest{Target: request.Target, Language: request.Acquisition.Language, Query: *request.Acquisition.Query, PageSize: request.Limits.MaxBatchItems}); err != nil {
			return nil, err
		}
	}
	streamCtx, cancel := context.WithCancel(ctx)
	results := make(chan legacySourceResult)
	stream := &legacySourceStream{cancel: cancel, ctx: streamCtx, results: results}
	go func() {
		defer close(results)
		if err := o.produce(streamCtx, request, results); err != nil {
			select {
			case results <- legacySourceResult{err: err}:
			case <-streamCtx.Done():
			}
		}
	}()
	return stream, nil
}

func (o *legacySourceOpener) produce(ctx context.Context, request resourcev2.SourceOpenRequest, out chan<- legacySourceResult) error {
	tracker := resourcev2.NewCatalogBoundSourcePhaseTracker(request, o.descriptor)
	var sequence uint64
	emit := func(frame resourcev2.SourceFrame) error {
		if sequence == ^uint64(0) {
			return resourcev2.NewError("RESOURCE_LIMIT", "Source sequence exhausted.")
		}
		frame.SessionID, frame.Generation, frame.Sequence = request.SessionID, request.Generation, sequence+1
		wire, err := resourcev2.ToProtoSourceFrame(frame)
		if err != nil {
			return err
		}
		size := proto.Size(wire)
		if size > int(request.Limits.MaxFrameBytes) {
			return resourcev2.NewError("RESOURCE_LIMIT", "Source frame byte limit.")
		}
		encoded, err := proto.Marshal(wire)
		if err != nil {
			return err
		}
		if err := resourceplugin.ValidateWire(encoded, wire.ProtoReflect().Descriptor()); err != nil {
			return err
		}
		if err := tracker.AdmitSized(frame, size); err != nil {
			return err
		}
		select {
		case out <- legacySourceResult{frame: frame}:
			sequence++
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	if err := emit(resourcev2.SourceFrame{Begin: &resourcev2.SourceBegin{Mode: request.Mode}}); err != nil {
		return err
	}
	coverage := resourcev2.SourceCoverage{Enumeration: resourcev2.EnumerationExhausted, Consistency: resourcev2.ConsistencyPointInTime, Limitations: []string{}}
	seen := make(map[string]struct{})
	cursorBytes := 0
	limitationBytes := 0
	var cursor, revision *string
	pages := 0
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		var page resourcev2.SourcePage
		var operation any
		var err error
		if request.Acquisition.Kind == resourcev2.SourceAcquisitionEnumerate {
			q := resourcev2.EnumerateRequest{Target: request.Target, PageSize: request.Limits.MaxBatchItems, Cursor: cursor}
			operation = q
			page, err = o.provider.(resourcev2.Enumerator).Enumerate(ctx, q)
		} else {
			q := resourcev2.NativeQueryRequest{Target: request.Target, Language: request.Acquisition.Language, Query: *request.Acquisition.Query, PageSize: request.Limits.MaxBatchItems, Cursor: cursor}
			operation = q
			page, err = o.provider.(resourcev2.NativeQuerier).NativeQuery(ctx, q)
		}
		if err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		for _, record := range page.Records {
			if !reflect.DeepEqual(record.Representation, request.Binding.Representation) {
				return emit(resourcev2.SourceFrame{Reset: &resourcev2.SourceReset{Reason: resourcev2.SourceResetBindingChanged, Message: "Source binding changed."}})
			}
		}
		if err := resourcev2.ValidateOperationResult(operation, page, o.descriptor); err != nil {
			return err
		}
		pages++
		switch page.Coverage.Kind {
		case "unknown":
			coverage.Enumeration = resourcev2.EnumerationUnknown
		case "partial":
			if coverage.Enumeration != resourcev2.EnumerationUnknown {
				coverage.Enumeration = resourcev2.EnumerationPartial
			}
		}
		addLimitation := func(value string) error {
			if value == "" {
				return nil
			}
			for _, existing := range coverage.Limitations {
				if existing == value {
					return nil
				}
			}
			if len(value) > int(request.Limits.MaxFrameBytes)-limitationBytes {
				return resourcev2.NewError("RESOURCE_LIMIT", "Source coverage byte limit.")
			}
			limitationBytes += len(value)
			if len(coverage.Limitations) == resourcev2.MaxSourceLimitations {
				return resourcev2.NewError("RESOURCE_LIMIT", "Source coverage limitation limit.")
			}
			coverage.Limitations = append(coverage.Limitations, value)
			return nil
		}
		if err := addLimitation(page.Coverage.Reason); err != nil {
			return err
		}
		for _, path := range page.Coverage.Paths {
			if err := addLimitation("path:" + path); err != nil {
				return err
			}
		}
		if page.Consistency != resourcev2.ConsistencyPointInTime || pages > 1 && (revision == nil || page.SourceRevision == nil || *revision != *page.SourceRevision) {
			coverage.Consistency = resourcev2.ConsistencyBestEffort
		}
		if pages == 1 {
			revision = page.SourceRevision
		}
		for _, record := range page.Records {
			observation := resourcev2.SourceObservation{Record: resourcev2.CompactSourceRecord(record)}
			if err := resourcev2.ValidateSourceObservation(request.Target, request.Target.Representation, observation); err != nil {
				return err
			}
			size, err := resourcev2.SourceObservationWireSize(observation)
			if err != nil {
				return err
			}
			if size > int(request.Limits.MaxFrameBytes) {
				return resourcev2.NewError("RESOURCE_LIMIT", "Source observation byte limit.")
			}
			if err := emit(resourcev2.SourceFrame{Snapshot: &resourcev2.SourceSnapshot{Observations: []resourcev2.SourceObservation{observation}}}); err != nil {
				return err
			}
		}
		if page.NextCursor == nil {
			break
		}
		if _, ok := seen[*page.NextCursor]; ok {
			return resourcev2.NewError("PROVIDER_ERROR", "Source repeated a cursor.")
		}
		if len(seen) >= 65536 {
			return resourcev2.NewError("RESOURCE_LIMIT", "Source pagination limit.")
		}
		if len(*page.NextCursor) > int(request.Limits.MaxFrameBytes)-cursorBytes {
			return resourcev2.NewError("RESOURCE_LIMIT", "Source cursor byte limit.")
		}
		next := strings.Clone(*page.NextCursor)
		cursorBytes += len(next)
		seen[next] = struct{}{}
		cursor = &next
	}
	return emit(resourcev2.SourceFrame{SnapshotEnd: &resourcev2.SourceSnapshotEnd{Coverage: coverage, Continuity: resourcev2.ContinuityNotApplicable}})
}
