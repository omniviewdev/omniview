package mcprelay

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// ResourceCollection deliberately retains each source page's claims separately.
// Returned cardinality is not represented as source cardinality or query coverage.
type ResourceCollection struct {
	Records      []resource.HostRecord         `json:"records"`
	Target       resourcev2.ReadTarget         `json:"target"`
	Operation    string                        `json:"operation"`
	SourcePages  []resource.SourcePageMetadata `json:"sourcePages"`
	Returned     int                           `json:"returned"`
	Truncated    bool                          `json:"truncated"`
	Continuation *string                       `json:"continuation,omitempty"`
}
type resourceContinuation struct {
	expires     time.Time
	binding     [32]byte
	observation resource.Observation
	pending     []resource.HostRecord
	next        *string
	metadata    resource.SourcePageMetadata
	size        int
}

var resourceCursors = struct {
	sync.Mutex
	entries map[string]resourceContinuation
	bytes   int
}{entries: make(map[string]resourceContinuation)}

func collectionBinding(ctx context.Context, tool ToolInfo, args resourceArguments, target resourcev2.ReadTarget) [32]byte {
	var query *resourcev2.Value
	if args.Query.Kind != "" {
		query = &args.Query
	}
	encoded, _ := json.Marshal(struct {
		Name     string
		Target   resourcev2.ReadTarget
		Query    *resourcev2.Value
		Language string
		Owner    string
	}{tool.MCPName, target, query, tool.Resource.Language, AuthorityCursorOwner(ctx)})
	return sha256.Sum256(encoded)
}
func saveResourceCursor(state resourceContinuation) (*string, error) {
	encoded, err := json.Marshal(state.pending)
	if err != nil {
		return nil, err
	}
	state.size = len(encoded)
	var random [32]byte
	if _, err := rand.Read(random[:]); err != nil {
		return nil, err
	}
	token := hex.EncodeToString(random[:])
	state.expires = time.Now().Add(5 * time.Minute)
	resourceCursors.Lock()
	defer resourceCursors.Unlock()
	for key, value := range resourceCursors.entries {
		if time.Now().After(value.expires) {
			delete(resourceCursors.entries, key)
			resourceCursors.bytes -= value.size
		}
	}
	if len(resourceCursors.entries) >= 128 || resourceCursors.bytes+state.size > 8<<20 {
		return nil, errors.New("resource continuation capacity reached")
	}
	resourceCursors.entries[token] = state
	resourceCursors.bytes += state.size
	return &token, nil
}
func loadResourceCursor(token string, binding [32]byte, observation resource.Observation) (resourceContinuation, error) {
	resourceCursors.Lock()
	defer resourceCursors.Unlock()
	state, ok := resourceCursors.entries[token]
	if !ok || time.Now().After(state.expires) || state.binding != binding || state.observation != observation {
		return resourceContinuation{}, errors.New("stale or mismatched resource continuation; discover tools again")
	}
	delete(resourceCursors.entries, token)
	resourceCursors.bytes -= state.size
	return state, nil
}

func collectResources(ctx context.Context, service resource.Service, tool ToolInfo, args resourceArguments, target resourcev2.ReadTarget) (ResourceCollection, error) {
	result := ResourceCollection{Records: []resource.HostRecord{}, SourcePages: []resource.SourcePageMetadata{}, Target: target, Operation: tool.Resource.Operation}
	limit := args.Limit
	if limit == 0 {
		limit = 200
	}
	if limit > 500 {
		return result, errors.New("resource limit exceeds 500")
	}
	binding := collectionBinding(ctx, tool, args, target)
	state := resourceContinuation{binding: binding, observation: tool.Resource.Observation}
	if args.Cursor != nil {
		var err error
		state, err = loadResourceCursor(*args.Cursor, binding, tool.Resource.Observation)
		if err != nil {
			return result, err
		}
	}
	// Even buffered records require fresh native admission against retained discovery.
	if len(state.pending) != 0 {
		admission, ok := service.(interface {
			AdmitObservation(context.Context, string, resourcev2.AccessRoute, string, resourcev2.ReadTarget) error
		})
		if !ok {
			return result, errors.New("resource observation admission unavailable")
		}
		if err := admission.AdmitObservation(ctx, tool.PluginID, tool.Resource.Route, tool.Resource.Operation, target); err != nil {
			return result, err
		}
		result.SourcePages = append(result.SourcePages, state.metadata)
	}
	pages := 0
	for {
		remaining := int(limit) - len(result.Records)
		if len(state.pending) > remaining {
			result.Records = append(result.Records, state.pending[:remaining]...)
			state.pending = state.pending[remaining:]
			break
		}
		result.Records = append(result.Records, state.pending...)
		state.pending = nil
		if len(result.Records) == int(limit) || (pages > 0 && state.next == nil) || (args.Cursor != nil && pages == 0 && state.next == nil) {
			break
		}
		if pages == 256 {
			break
		}
		var page resource.HostSourcePage
		var err error
		if tool.Resource.Operation == "resource.NativeQuery" {
			page, err = service.NativeQuery(ctx, tool.PluginID, resource.HostNativeQueryRequest{TargetID: tool.MCPName, Request: resourcev2.NativeQueryRequest{Target: target, Language: tool.Resource.Language, Query: args.Query, PageSize: 256, Cursor: state.next}})
		} else {
			page, err = service.Enumerate(ctx, tool.PluginID, resource.HostEnumerateRequest{TargetID: tool.MCPName, Request: resourcev2.EnumerateRequest{Target: target, PageSize: 256, Cursor: state.next}})
		}
		if err != nil {
			return ResourceCollection{}, err
		}
		pages++
		result.SourcePages = append(result.SourcePages, page.SourcePage)
		state.pending = page.Records
		state.next = page.SourcePage.NextCursor
		state.metadata = page.SourcePage
	}
	result.Returned = len(result.Records)
	result.Truncated = len(state.pending) > 0 || state.next != nil
	if result.Truncated {
		cursor, err := saveResourceCursor(state)
		if err != nil {
			return ResourceCollection{}, err
		}
		result.Continuation = cursor
	}
	return result, nil
}
