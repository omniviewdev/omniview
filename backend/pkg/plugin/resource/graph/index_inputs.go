package graph

import (
	"encoding/json"
	"maps"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/registry"
	"github.com/tidwall/gjson"
)

// A witness belongs to one immutable declaration/binding snapshot. Retirement
// drops the whole cache. Only declared values are retained, never full records.
// Raw JSON equality is deliberately conservative: formatting changes may rebuild.
type relationshipInputs struct {
	plugin, connection string
	incarnation        string
	hasIncarnation     bool
	labels             map[string]string
	fields             []dependencyValue
}

type dependencyValue struct {
	raw, text string
	number    float64
	kind      gjson.Type
	exists    bool
}

func dependency(raw json.RawMessage, path string) dependencyValue {
	value := gjson.GetBytes(raw, path)
	return dependencyValue{raw: value.Raw, text: value.Str, number: value.Num, kind: value.Type, exists: value.Exists()}
}

// Reuse an already validated canonical key only when every address dimension
// matches. Scope order is not identity; incarnation and route remain separate.
func updateKeys(old, updated registry.ResourceEntry) (string, string) {
	key := old.EntryKey()
	a, b := old.Reference.Address, updated.Reference.Address
	if key != "" && a.Provider == b.Provider && a.Authority == b.Authority && a.Type == b.Type && a.ID == b.ID && scopeMatches(a.Scope, b.Scope) {
		return key, key
	}
	return key, updated.EntryKey()
}

func dependencyPaths(snapshot *boundSet, visit func(string) bool) bool {
	for _, declaration := range snapshot.declarations {
		if declaration.Extractor == nil {
			continue
		}
		if !visit(declaration.Extractor.FieldPath) {
			return false
		}
		for _, extractor := range declaration.ScopeExtractors {
			if !visit(extractor.FieldPath) {
				return false
			}
		}
	}
	return true
}

func (gi *Indexer) inputsUnchanged(old, entry registry.ResourceEntry, raw json.RawMessage, oldKey, key string) bool {
	if old.PluginID != entry.PluginID || old.Route != entry.Route || oldKey != key {
		return false
	}
	g := gi.graph
	g.mu.RLock()
	defer g.mu.RUnlock()
	snapshot := g.boundDeclarations[declMapKey{pluginID: entry.PluginID, connectionID: entry.Route.Connection, resourceKey: entry.Reference.Address.Type}]
	if snapshot == nil {
		return false
	}
	previous, ok := snapshot.inputs[key]
	if !ok || previous.plugin != entry.PluginID || previous.connection != entry.Route.Connection || previous.hasIncarnation != (entry.Reference.Incarnation != nil) || !maps.Equal(previous.labels, entry.Labels) {
		return false
	}
	if entry.Reference.Incarnation != nil && previous.incarnation != *entry.Reference.Incarnation {
		return false
	}
	index := 0
	return dependencyPaths(snapshot, func(path string) bool {
		value := dependency(raw, path)
		// Raw distinguishes absent, null, type, arrays and object members. The
		// extractor observes all nested selector/owner-reference values here.
		equal := index < len(previous.fields) && previous.fields[index] == value
		index++
		return equal
	}) && index == len(previous.fields)
}

func (gi *Indexer) rememberInputs(entry registry.ResourceEntry, raw json.RawMessage, snapshot *boundSet, epoch uint64, key string) {
	g := gi.graph
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.currentSnapshot(nodeFromEntry(entry), snapshot) || snapshot.inputEpoch != epoch {
		return
	}
	witness := relationshipInputs{plugin: entry.PluginID, connection: entry.Route.Connection, labels: maps.Clone(entry.Labels), hasIncarnation: entry.Reference.Incarnation != nil}
	if entry.Reference.Incarnation != nil {
		witness.incarnation = *entry.Reference.Incarnation
	}
	cacheable := dependencyPaths(snapshot, func(path string) bool {
		// Root modifiers can select or transform the whole body. They remain
		// valid extraction inputs, but never become retained full-record guards.
		if len(path) > 0 && path[0] == '@' {
			return false
		}
		value := dependency(raw, path)
		if len(raw) > 0 && len(value.raw) == len(raw) {
			return false
		}
		witness.fields = append(witness.fields, value)
		return true
	})
	if !cacheable {
		return
	}
	if snapshot.inputs == nil {
		snapshot.inputs = make(map[string]relationshipInputs)
	}
	snapshot.inputs[key] = witness
}

// Called under g.mu by every direct node eviction, including deletes. This
// prevents an unchanged later observation from trusting manually removed edges.
func (g *RelationshipGraph) forgetInputsLocked(key string) {
	if key == "" {
		return
	}
	for _, snapshot := range g.boundDeclarations {
		delete(snapshot.inputs, key)
		snapshot.inputEpoch++
	}
}

func (gi *Indexer) inputSnapshot(entry registry.ResourceEntry) (*boundSet, uint64) {
	g := gi.graph
	g.mu.RLock()
	defer g.mu.RUnlock()
	snapshot := g.boundDeclarations[declMapKey{pluginID: entry.PluginID, connectionID: entry.Route.Connection, resourceKey: entry.Reference.Address.Type}]
	if snapshot == nil {
		return nil, 0
	}
	return snapshot, snapshot.inputEpoch
}
