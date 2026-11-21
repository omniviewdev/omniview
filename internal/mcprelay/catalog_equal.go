package mcprelay

import "reflect"

// sameTool and sameCatalog are the relay's one definition of "the catalog did
// not change". They replace reflect.DeepEqual, which on a ToolInfo walked into
// ResourceBinding.Observation and, across a plugin restart, into the retired
// and the new *pluginState (provider, backend, maps): live runtime state read
// with no lock, inside the authority's critical section.
//
// ToolInfo and ResourceBinding are listed field by field;
// TestSameToolComparesWhatAdvertisesAndBinds fails when either gains a field
// that is not listed here.
func sameCatalog(a, b []ToolInfo) bool {
	// reflect.DeepEqual told a nil slice from an empty one, and the first
	// publication of an empty catalog (the relay starts with nil) relied on it.
	if (a == nil) != (b == nil) || len(a) != len(b) {
		return false
	}
	for i := range a {
		if !sameTool(a[i], b[i]) {
			return false
		}
	}
	return true
}

func sameTool(a, b ToolInfo) bool {
	return a.MCPName == b.MCPName &&
		a.PluginID == b.PluginID &&
		a.PluginName == b.PluginName &&
		a.Name == b.Name &&
		a.Title == b.Title &&
		a.Description == b.Description &&
		a.Scope == b.Scope &&
		a.ConnectionOwner == b.ConnectionOwner &&
		a.ReadOnly == b.ReadOnly &&
		a.Destructive == b.Destructive &&
		a.Idempotent == b.Idempotent &&
		a.OpenWorld == b.OpenWorld &&
		a.BuiltIn == b.BuiltIn &&
		a.Status == b.Status &&
		a.Generation == b.Generation &&
		// Schemas are decoded JSON (maps, slices, scalars): plain data.
		reflect.DeepEqual(a.InputSchema, b.InputSchema) &&
		reflect.DeepEqual(a.OutputSchema, b.OutputSchema) &&
		sameBinding(a.Resource, b.Resource)
}

func sameBinding(a, b *ResourceBinding) bool {
	if a == b {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return a.PluginID == b.PluginID &&
		a.Type == b.Type &&
		a.Operation == b.Operation &&
		a.Verb == b.Verb &&
		a.Language == b.Language &&
		a.Action == b.Action &&
		a.TypeAction == b.TypeAction &&
		// Retained observation: identity of the plugin generation and the
		// catalog digest, never its content (see resource.Observation.Same).
		a.Observation.Same(b.Observation) &&
		// Host read lanes are singletons: the handler calls this very lane.
		sameLane(a.Logs, b.Logs) &&
		sameLane(a.Metrics, b.Metrics) &&
		sameLane(a.Graph, b.Graph) &&
		// The rest is advertisement data copied from the plugin's catalog.
		reflect.DeepEqual(a.Route, b.Route) &&
		reflect.DeepEqual(a.Descriptor, b.Descriptor) &&
		reflect.DeepEqual(a.Target, b.Target) &&
		reflect.DeepEqual(a.Dimensions, b.Dimensions) &&
		reflect.DeepEqual(a.QuerySchema, b.QuerySchema) &&
		reflect.DeepEqual(a.ActionDescriptor, b.ActionDescriptor) &&
		reflect.DeepEqual(a.MetricDescriptors, b.MetricDescriptors) &&
		reflect.DeepEqual(a.Types, b.Types)
}

// sameLane compares two read lanes by identity. It never looks inside a lane,
// which is live host state; a lane that cannot be compared is not the same.
func sameLane(a, b any) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	left, right := reflect.ValueOf(a), reflect.ValueOf(b)
	if left.Type() != right.Type() {
		return false
	}
	if left.Kind() == reflect.Pointer {
		return left.Pointer() == right.Pointer()
	}
	return left.Comparable() && left.Equal(right)
}
