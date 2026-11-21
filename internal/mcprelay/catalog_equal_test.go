package mcprelay

import (
	"context"
	"reflect"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"

	hostlogs "github.com/omniviewdev/omniview/backend/pkg/plugin/logs"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
	sdkmetric "github.com/omniviewdev/plugin-sdk/pkg/v1/metric"
)

// liveLogsReader stands for a host read lane that is in use while catalogs are
// compared: it guards its own state with its own lock and knows nothing of the
// relay's.
type liveLogsReader struct {
	mu   sync.Mutex
	seen map[int]int
}

func newLiveLogsReader() *liveLogsReader { return &liveLogsReader{seen: map[int]int{}} }

func (r *liveLogsReader) ReadResourceLogs(context.Context, string, sdklogs.CreateSessionOptions) (*hostlogs.HeadlessResult, error) {
	return nil, nil
}

func (r *liveLogsReader) churn(stop <-chan struct{}) {
	for i := 0; ; i++ {
		select {
		case <-stop:
			return
		default:
		}
		r.mu.Lock()
		r.seen[i%64] = i
		delete(r.seen, (i+7)%64)
		r.mu.Unlock()
	}
}

func resourceTool(reader ResourceLogsReader) ToolInfo {
	return ToolInfo{
		MCPName: "kubernetes_pods_logs", PluginID: "kubernetes", Name: "logs", Scope: ScopeConnection, Status: StatusOK,
		InputSchema: map[string]any{"type": "object", "required": []string{"connection_id"}},
		Resource: &ResourceBinding{
			PluginID: "kubernetes", Route: resourcev2.AccessRoute{Connection: "cluster"}, Type: "pods",
			Operation: "resource.ScopeValues", Dimensions: []string{"namespace"}, Logs: reader,
		},
	}
}

// A catalog rebuilt by a discovery pass holds new allocations of the same
// tools. Comparing it must not read what a binding points at: the read lanes
// are in use by running calls under locks the relay does not hold, and a
// content comparison read them unlocked (a data race; under load the Go
// runtime's concurrent map check is fatal). Run with -race.
func TestCatalogComparisonReadsNoLiveReaderState(t *testing.T) {
	old, current := newLiveLogsReader(), newLiveLogsReader()
	stop := make(chan struct{})
	var running sync.WaitGroup
	for _, reader := range []*liveLogsReader{old, current} {
		running.Add(1)
		go func() { defer running.Done(); reader.churn(stop) }()
	}
	t.Cleanup(func() { close(stop); running.Wait() })

	authority := NewAuthority()
	t.Cleanup(authority.Retire)
	authority.UpdateCatalog([]ToolInfo{resourceTool(old)})
	for range 2000 {
		authority.UpdateCatalog([]ToolInfo{resourceTool(current)})
		authority.UpdateCatalog([]ToolInfo{resourceTool(old)})
	}
}

func TestSameToolComparesWhatAdvertisesAndBinds(t *testing.T) {
	reader := newLiveLogsReader()
	require.True(t, sameTool(resourceTool(reader), resourceTool(reader)), "a rebuilt copy of the same tool is the same tool")
	require.True(t, sameTool(ToolInfo{}, ToolInfo{}))
	require.False(t, sameTool(resourceTool(reader), resourceTool(newLiveLogsReader())), "another read lane is another tool: the handler would call the old one")
	require.False(t, sameTool(resourceTool(reader), resourceTool(nil)))
	require.False(t, sameTool(resourceTool(reader), ToolInfo{}))

	mutations := map[string]func(*ToolInfo){
		"MCPName":         func(t *ToolInfo) { t.MCPName += "x" },
		"PluginID":        func(t *ToolInfo) { t.PluginID += "x" },
		"PluginName":      func(t *ToolInfo) { t.PluginName += "x" },
		"Name":            func(t *ToolInfo) { t.Name += "x" },
		"Title":           func(t *ToolInfo) { t.Title += "x" },
		"Description":     func(t *ToolInfo) { t.Description += "x" },
		"Scope":           func(t *ToolInfo) { t.Scope = ScopePlugin },
		"ConnectionOwner": func(t *ToolInfo) { t.ConnectionOwner += "x" },
		"ReadOnly":        func(t *ToolInfo) { t.ReadOnly = !t.ReadOnly },
		"Destructive":     func(t *ToolInfo) { t.Destructive = !t.Destructive },
		"Idempotent":      func(t *ToolInfo) { t.Idempotent = !t.Idempotent },
		"OpenWorld":       func(t *ToolInfo) { t.OpenWorld = !t.OpenWorld },
		"InputSchema":     func(t *ToolInfo) { t.InputSchema = map[string]any{"type": "string"} },
		"OutputSchema":    func(t *ToolInfo) { t.OutputSchema = map[string]any{"type": "string"} },
		"BuiltIn":         func(t *ToolInfo) { t.BuiltIn = !t.BuiltIn },
		"Status":          func(t *ToolInfo) { t.Status = StatusConflict },
		"Generation":      func(t *ToolInfo) { t.Generation++ },
		"Resource":        func(t *ToolInfo) { t.Resource = nil },
	}
	assertCoversEveryField(t, reflect.TypeOf(ToolInfo{}), mutations)
	for name, mutate := range mutations {
		changed := resourceTool(reader)
		mutate(&changed)
		require.False(t, sameTool(resourceTool(reader), changed), "ToolInfo.%s must make a tool different", name)
	}

	bindings := map[string]func(*ResourceBinding){
		"PluginID":          func(b *ResourceBinding) { b.PluginID += "x" },
		"Route":             func(b *ResourceBinding) { b.Route.Connection += "x" },
		"Type":              func(b *ResourceBinding) { b.Type += "x" },
		"Operation":         func(b *ResourceBinding) { b.Operation += "x" },
		"Descriptor":        func(b *ResourceBinding) { b.Descriptor.Type += "x" },
		"Observation":       nil, // opaque outside the resource package: resource.Observation.Same is tested there
		"Target":            func(b *ResourceBinding) { b.Target.Type += "x" },
		"Verb":              func(b *ResourceBinding) { b.Verb += "x" },
		"Language":          func(b *ResourceBinding) { b.Language += "x" },
		"Action":            func(b *ResourceBinding) { b.Action += "x" },
		"TypeAction":        func(b *ResourceBinding) { b.TypeAction = !b.TypeAction },
		"Dimensions":        func(b *ResourceBinding) { b.Dimensions = []string{"other"} },
		"Logs":              func(b *ResourceBinding) { b.Logs = newLiveLogsReader() },
		"QuerySchema":       func(b *ResourceBinding) { b.QuerySchema = &resourcev2.Schema{} },
		"ActionDescriptor":  func(b *ResourceBinding) { b.ActionDescriptor = &resourcev2.ActionDescriptor{} },
		"Metrics":           func(b *ResourceBinding) { b.Metrics = &fakeMetricReader{} },
		"Graph":             func(b *ResourceBinding) { b.Graph = &fakeGraphReader{} },
		"MetricDescriptors": func(b *ResourceBinding) { b.MetricDescriptors = []sdkmetric.MetricDescriptor{{ID: "cpu"}} },
		"Types":             func(b *ResourceBinding) { b.Types = map[string]RouteType{"pods": {}} },
	}
	assertCoversEveryField(t, reflect.TypeOf(ResourceBinding{}), bindings)
	for name, mutate := range bindings {
		if mutate == nil {
			continue
		}
		changed := resourceTool(reader)
		mutate(changed.Resource)
		require.False(t, sameTool(resourceTool(reader), changed), "ResourceBinding.%s must make a tool different", name)
	}
}

// assertCoversEveryField fails when the compared type grows a field that the
// table of mutations (and so the comparison) does not know.
func assertCoversEveryField[T any](t *testing.T, ty reflect.Type, table map[string]T) {
	t.Helper()
	for i := range ty.NumField() {
		_, ok := table[ty.Field(i).Name]
		require.True(t, ok, "%s.%s is not covered by the comparison: add it to sameTool or sameBinding and to this table", ty.Name(), ty.Field(i).Name)
	}
	require.Len(t, table, ty.NumField())
}

func TestSameCatalogKeepsNilAndEmptyApart(t *testing.T) {
	// reflect.DeepEqual told nil and empty slices apart; the first publication
	// of an empty catalog relied on it (the relay starts with a nil catalog).
	require.False(t, sameCatalog(nil, []ToolInfo{}))
	require.True(t, sameCatalog(nil, nil))
	require.True(t, sameCatalog([]ToolInfo{}, []ToolInfo{}))
	one := []ToolInfo{{MCPName: "a"}}
	require.False(t, sameCatalog(one, []ToolInfo{{MCPName: "a"}, {MCPName: "b"}}))
	require.False(t, sameCatalog(one, []ToolInfo{{MCPName: "b"}}))
	require.True(t, sameCatalog(one, []ToolInfo{{MCPName: "a"}}))
}

// An in-flight, bound call stays allowed across a rediscovery that rebuilt its
// tool, and is cancelled when the tool's read lane changed.
func TestRebuiltCatalogKeepsBoundCallsAndChangedLaneCancelsThem(t *testing.T) {
	a, _, _, ctx := authorityFixture(t)
	reader := newLiveLogsReader()
	tool := resourceTool(reader)
	a.UpdateCatalog([]ToolInfo{tool})
	bound, err := a.Bind(ctx, tool, "cluster", []byte(`{"dimension":"namespace"}`))
	require.NoError(t, err)

	a.UpdateCatalog([]ToolInfo{resourceTool(reader)})
	require.NoError(t, bound.Err(), "a rebuilt, equal tool must not cancel a bound call")

	a.UpdateCatalog([]ToolInfo{resourceTool(newLiveLogsReader())})
	require.Error(t, bound.Err(), "a tool bound to another read lane is not the tool the call was bound to")
}
