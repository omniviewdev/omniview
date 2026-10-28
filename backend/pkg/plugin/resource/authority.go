package resource

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"sync"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/utils"
	"github.com/omniviewdev/omniview/internal/appstate"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

const authorityStoreName = "resource-authorities-v1"

// Store bytes are read with a 32 MiB ceiling; SDK JSON admission additionally
// enforces its document-byte, depth, node and field limits. Binding count is
// another upper bound, not a promise that every 65,536-entry store is admissible.
const maxAuthorityBindings = 65536
const maxAuthorityStoreBytes = 32 << 20

// AuthorityResolution is host identity evidence, never authorization or permission
// to share bodies, caches, or projections. Changed requires acquisition invalidation.
type AuthorityResolution struct {
	Authority   string
	Continuity  string
	Limitations []string
	Changed     bool
}

type authorityRoute struct{ Plugin, Connection, Provider, ResourceType string }
type authorityBinding struct {
	Authority string
	HasHint   bool
	Hint      resourcev2.NativeAuthorityHint
}

// authorityDiskEntry is private persistence data, not a public resource DTO.
// A sequence permits detecting duplicate routes before inserting into the map.
type authorityDiskEntry struct {
	Plugin       string                          `json:"plugin"`
	Connection   string                          `json:"connection"`
	Provider     string                          `json:"provider"`
	ResourceType string                          `json:"resourceType"`
	Authority    string                          `json:"authority"`
	Hint         *resourcev2.NativeAuthorityHint `json:"hint,omitempty"`
}

// AuthorityResolver owns one plugin-scoped store. The controller must retain one
// resolver per store; concurrent resolver instances must not write the same store.
// No native scheme is reviewed for stable identity yet. All hints therefore bind
// only within an exact connection and Type, even when claiming stableNative.
// Missing hints cannot detect retargeting. Deleting local state loses continuity.
// No incarnation is inferred. Neither endpoints nor credentials are inspected.
type AuthorityResolver struct {
	mu       sync.Mutex
	root     *appstate.ScopedRoot
	bindings map[authorityRoute]authorityBinding
}

func NewAuthorityResolver(root *appstate.ScopedRoot) (*AuthorityResolver, error) {
	if root == nil {
		return nil, errors.New("authority: nil plugin store")
	}
	store, err := utils.GetStore(authorityStoreName, root)
	if err != nil {
		return nil, err
	}
	defer store.Close()
	data, err := io.ReadAll(io.LimitReader(store, maxAuthorityStoreBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxAuthorityStoreBytes {
		return nil, errors.New("authority: store exceeds byte limit")
	}
	r := &AuthorityResolver{root: root, bindings: make(map[authorityRoute]authorityBinding)}
	if len(data) == 0 {
		return r, nil
	}
	// Validate before concrete decoding: depth, nodes, duplicate fields and UTF-8
	// are bounded by the canonical SDK JSON admission policy.
	if err := resourcev2.ValidateJSON(data); err != nil {
		return nil, fmt.Errorf("authority: invalid store JSON: %w", err)
	}
	if bytes.TrimSpace(data)[0] != '[' {
		return nil, errors.New("authority: store must contain an entry sequence")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var entries []authorityDiskEntry
	if err := decoder.Decode(&entries); err != nil {
		return nil, fmt.Errorf("authority: decode store: %w", err)
	}
	if len(entries) > maxAuthorityBindings {
		return nil, errors.New("authority: binding limit exceeded")
	}
	for _, entry := range entries {
		route := authorityRoute{entry.Plugin, entry.Connection, entry.Provider, entry.ResourceType}
		if route.Plugin == "" || route.Connection == "" || route.Provider == "" || route.ResourceType == "" || entry.Authority == "" {
			return nil, errors.New("authority: invalid persisted binding")
		}
		if _, duplicate := r.bindings[route]; duplicate {
			return nil, errors.New("authority: duplicate persisted route")
		}
		binding := authorityBinding{Authority: entry.Authority, HasHint: entry.Hint != nil}
		if entry.Hint != nil {
			binding.Hint = *entry.Hint
		}
		r.bindings[route] = binding
	}
	return r, nil
}

// Resolve issues an opaque local ID. Hints are untrusted observations, not IDs.
// A changed hint replaces the current binding; returning to an old hint does not
// resurrect an old authority. Route aliases never merge, even with equal hints.
func (r *AuthorityResolver) Resolve(pluginID, connectionID, provider, resourceType string, hint *resourcev2.NativeAuthorityHint) (AuthorityResolution, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if pluginID == "" || connectionID == "" || provider == "" || resourceType == "" {
		return AuthorityResolution{}, errors.New("authority: plugin, connection, provider and resource type required")
	}
	for _, text := range []string{pluginID, connectionID, provider, resourceType} {
		if !utf8.ValidString(text) {
			return AuthorityResolution{}, errors.New("authority: route must be UTF-8")
		}
	}
	if hint != nil {
		for _, text := range []string{hint.Scheme, hint.ID, hint.Continuity} {
			if !utf8.ValidString(text) {
				return AuthorityResolution{}, errors.New("authority: hint must be UTF-8")
			}
		}
	}
	candidate := authorityBinding{HasHint: hint != nil}
	if hint != nil {
		candidate.Hint = *hint
	}
	route := authorityRoute{pluginID, connectionID, provider, resourceType}
	previous, exists := r.bindings[route]
	changed := exists && (previous.HasHint != candidate.HasHint || previous.Hint != candidate.Hint)
	if exists && !changed {
		return authorityResult(previous.Authority, false), nil
	}
	if !exists && len(r.bindings) >= maxAuthorityBindings {
		return AuthorityResolution{}, errors.New("authority: binding limit exceeded")
	}
	id, err := uuid.NewRandom()
	if err != nil {
		return AuthorityResolution{}, fmt.Errorf("authority: issue ID: %w", err)
	}
	candidate.Authority = "local:" + id.String()
	r.bindings[route] = candidate
	if err := r.persist(); err != nil {
		if exists {
			r.bindings[route] = previous
		} else {
			delete(r.bindings, route)
		}
		return AuthorityResolution{}, err
	}
	return authorityResult(candidate.Authority, changed), nil
}

func authorityResult(id string, changed bool) AuthorityResolution {
	return AuthorityResolution{Authority: id, Continuity: resourcev2.ContinuityConnectionLocal, Changed: changed, Limitations: []string{
		"Connection- and Type-local identity only; aliases are isolated and no stable native scheme is approved.",
		"Continuity requires this local store; unreported retargeting cannot be detected.",
	}}
}

func (r *AuthorityResolver) persist() error {
	entries := make([]authorityDiskEntry, 0, len(r.bindings))
	for route, binding := range r.bindings {
		entry := authorityDiskEntry{Plugin: route.Plugin, Connection: route.Connection, Provider: route.Provider, ResourceType: route.ResourceType, Authority: binding.Authority}
		if binding.HasHint {
			hint := binding.Hint
			entry.Hint = &hint
		}
		entries = append(entries, entry)
	}
	data, err := json.Marshal(entries)
	if err != nil {
		return err
	}
	if len(data) > maxAuthorityStoreBytes {
		return errors.New("authority: store exceeds byte limit")
	}
	// Never write state that the bounded reader would reject after restart.
	if err := resourcev2.ValidateJSON(data); err != nil {
		return fmt.Errorf("authority: store JSON limit: %w", err)
	}
	temp := authorityStoreName + "." + uuid.NewString() + ".tmp"
	file, err := r.root.OpenFile(temp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer r.root.Remove(temp)
	if _, err = file.Write(data); err != nil {
		file.Close()
		return err
	}
	if err = file.Sync(); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return r.root.Rename(temp, authorityStoreName)
}

// InvalidateConnection retires every provider binding for an explicitly changed
// route. Retargeting must not reuse authority merely because its hint is equal.
// A failed durable write restores the old in-memory bindings and returns error.
func (r *AuthorityResolver) InvalidateConnection(pluginID, connectionID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	removed := make(map[authorityRoute]authorityBinding)
	for route, binding := range r.bindings {
		if route.Plugin == pluginID && route.Connection == connectionID {
			removed[route] = binding
			delete(r.bindings, route)
		}
	}
	if len(removed) == 0 {
		return nil
	}
	if err := r.persist(); err != nil {
		for route, binding := range removed {
			r.bindings[route] = binding
		}
		return err
	}
	return nil
}

// Matches checks a current host-issued binding without creating identity state.
func (r *AuthorityResolver) Matches(pluginID, connectionID, provider, resourceType, authority string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	binding, exists := r.bindings[authorityRoute{pluginID, connectionID, provider, resourceType}]
	return exists && authority != "" && binding.Authority == authority
}
