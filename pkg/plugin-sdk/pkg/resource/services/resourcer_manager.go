package services

import (
	"fmt"
	"regexp"
	"strings"
	"sync"

	"github.com/omniviewdev/plugin-sdk/pkg/resource/types"
)

// ResourcerManager manages all of the resourcers for a given resource type. It is responsible for
// registering, retreiving, and managing resourcers for a given resource type.
type ResourcerManager[ClientT any] interface {
	// RegisterResourcer registers a new resourcer for the given resource type
	RegisterResourcer(resourceType string, resourcer types.Resourcer[ClientT]) error
	// RegisterResourcersFromMap registers a new resourcer for the given resource type given
	// a map of meta objects
	RegisterResourcersFromMap(resourcerMap map[types.ResourceMeta]types.Resourcer[ClientT]) error
	// RegisterPatternResourcer registers a resourcer that matches resource types by pattern
	RegisterPatternResourcer(pattern string, resourcer types.Resourcer[ClientT]) error
	// RegisterPatternResourcersFromMap registers pattern resourcers from a map of patterns
	RegisterPatternResourcersFromMap(resourcerMap map[string]types.Resourcer[ClientT]) error
	// DeregisterResourcer deregisters the resourcer for the given resource type
	DeregisterResourcer(resourceType string) error
	// GetResourcer returns the resourcer for the given resource type.
	// It first tries an exact match in the store, then falls back to pattern matching.
	GetResourcer(resourceType string) (types.Resourcer[ClientT], error)
}

// patternEntry holds a pattern string and its associated resourcer for fallback matching.
type patternEntry[ClientT any] struct {
	pattern   string
	resourcer types.Resourcer[ClientT]
}

type resourcerManager[ClientT any] struct {
	// map of resource type to resourcer (exact match)
	store map[string]types.Resourcer[ClientT]
	// pattern resourcers for wildcard fallback
	patternResourcers []patternEntry[ClientT]
	// put this last for pointer byte alignment
	sync.RWMutex
}

func NewResourcerManager[ClientT any]() ResourcerManager[ClientT] {
	return &resourcerManager[ClientT]{
		store: make(map[string]types.Resourcer[ClientT]),
	}
}

// RegisterResourcer registers a new resourcer for the given resource type.
func (r *resourcerManager[ClientT]) RegisterResourcer(
	resourceType string,
	resourcer types.Resourcer[ClientT],
) error {
	r.Lock()
	defer r.Unlock()

	if _, exists := r.store[resourceType]; exists {
		return fmt.Errorf("resourcer for resource type %s already exists", resourceType)
	}

	r.store[resourceType] = resourcer
	return nil
}

// RegisterResourcersFromMap registers a new resourcer for the given resource type given
// a map of meta objects.
func (r *resourcerManager[ClientT]) RegisterResourcersFromMap(
	resourcerMap map[types.ResourceMeta]types.Resourcer[ClientT],
) error {
	r.Lock()
	defer r.Unlock()

	for meta, resourcer := range resourcerMap {
		id := meta.String()
		if _, exists := r.store[id]; exists {
			return fmt.Errorf("resourcer for resource type %s already exists", id)
		}
		r.store[id] = resourcer
	}

	return nil
}

// RegisterPatternResourcer registers a resourcer that matches resource types by wildcard pattern.
func (r *resourcerManager[ClientT]) RegisterPatternResourcer(
	pattern string,
	resourcer types.Resourcer[ClientT],
) error {
	r.Lock()
	defer r.Unlock()
	for _, entry := range r.patternResourcers {
		if entry.pattern == pattern {
			return fmt.Errorf("pattern resourcer for pattern %s already exists", pattern)
		}
	}
	r.patternResourcers = append(r.patternResourcers, patternEntry[ClientT]{
		pattern:   pattern,
		resourcer: resourcer,
	})
	return nil
}

// RegisterPatternResourcersFromMap registers pattern resourcers from a map of patterns.
func (r *resourcerManager[ClientT]) RegisterPatternResourcersFromMap(
	resourcerMap map[string]types.Resourcer[ClientT],
) error {
	r.Lock()
	defer r.Unlock()
	for pattern, resourcer := range resourcerMap {
		for _, entry := range r.patternResourcers {
			if entry.pattern == pattern {
				return fmt.Errorf("pattern resourcer for pattern %s already exists", pattern)
			}
		}
		r.patternResourcers = append(r.patternResourcers, patternEntry[ClientT]{
			pattern:   pattern,
			resourcer: resourcer,
		})
	}
	return nil
}

// DeregisterResourcer deregisters the resourcer for the given resource type.
func (r *resourcerManager[ClientT]) DeregisterResourcer(resourceType string) error {
	r.Lock()
	defer r.Unlock()
	if _, exists := r.store[resourceType]; !exists {
		return fmt.Errorf("resourcer for resource type %s does not exist", resourceType)
	}
	delete(r.store, resourceType)
	return nil
}

// GetResourcer returns the resourcer for the given resource type.
// It first tries an exact match in the store, then falls back to pattern matching.
func (r *resourcerManager[ClientT]) GetResourcer(
	resourceType string,
) (types.Resourcer[ClientT], error) {
	r.RLock()
	defer r.RUnlock()

	// exact match first
	if resourcer, exists := r.store[resourceType]; exists {
		return resourcer, nil
	}

	// pattern fallback
	for _, entry := range r.patternResourcers {
		if match(entry.pattern, resourceType) {
			return entry.resourcer, nil
		}
	}

	return nil, fmt.Errorf("resourcer for resource type %s does not exist", resourceType)
}

// wildCardToRegexp converts a wildcard pattern to a regular expression pattern.
func wildCardToRegexp(pattern string) string {
	var result strings.Builder
	for i, literal := range strings.Split(pattern, "*") {
		// Replace * with .*
		if i > 0 {
			result.WriteString(".*")
		}

		// Quote any regular expression meta characters in the
		// literal text.
		result.WriteString(regexp.QuoteMeta(literal))
	}
	return result.String()
}

func match(pattern string, value string) bool {
	result, _ := regexp.MatchString(wildCardToRegexp(pattern), value)
	return result
}
