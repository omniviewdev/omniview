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
	// RegisterDynamicResourcer registers a new dynamic resourcer for the given resource type
	RegisterDynamicResourcer(resourceType string, resourcer types.DynamicResourcer[ClientT]) error
	// RegisterResourcersFromMap registers a new resourcer for the given resource type given
	// a map of meta objects
	RegisterResourcersFromMap(resourcerMap map[types.ResourceMeta]types.Resourcer[ClientT]) error
	// RegisterDunamicResourcersFromMap registers a new dynamic resourcer for the given resource type given
	// a map of patterns
	RegisterDynamicResourcersFromMap(resourcerMap map[string]types.DynamicResourcer[ClientT]) error
	// DeregisterResourcer deregisters the resourcer for the given resource type
	DeregisterResourcer(resourceType string) error
	// GetResourcer returns the resourcer for the given resource type
	GetResourcer(resourceType string) (types.Resourcer[ClientT], error)
	// GetDynamicResourcer attempts to find a dynamic resourcer for the given resource type
	GetDynamicResourcer(resourceType string) (types.DynamicResourcer[ClientT], error)
	// HasDynamicResourcers returns true if there are dynamic resourcers associated with the manager
	HasDynamicResourcers() bool
}

type resourcerManager[ClientT any] struct {
	// map of resource type to resourcer
	store map[string]types.Resourcer[ClientT]
	// dynamic resourcer store to fallback to
	dynamicResourcers map[string]types.DynamicResourcer[ClientT]
	// put this last for pointer byte alignment
	sync.RWMutex
}

func NewResourcerManager[ClientT any]() ResourcerManager[ClientT] {
	return &resourcerManager[ClientT]{
		store:             make(map[string]types.Resourcer[ClientT]),
		dynamicResourcers: make(map[string]types.DynamicResourcer[ClientT]),
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

// RegisterDynamicResourcer registers a new dynamic resourcer for the given resource type.
func (r *resourcerManager[ClientT]) RegisterDynamicResourcer(
	resourceType string,
	resourcer types.DynamicResourcer[ClientT],
) error {
	r.Lock()
	defer r.Unlock()
	if _, exists := r.dynamicResourcers[resourceType]; exists {
		return fmt.Errorf("dynamic resourcer for resource type %s already exists", resourceType)
	}
	r.dynamicResourcers[resourceType] = resourcer
	return nil
}

// Has dynamic resourcers returns true if there are dynamic resourcers associated with the manager.
func (r *resourcerManager[ClientT]) HasDynamicResourcers() bool {
	r.RLock()
	defer r.RUnlock()
	return len(r.dynamicResourcers) > 0
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

// RegisterDynamicResourcersFromMap registers a new dynamic resourcer for the given resource type given
// a map of patterns.
func (r *resourcerManager[ClientT]) RegisterDynamicResourcersFromMap(
	resourcerMap map[string]types.DynamicResourcer[ClientT],
) error {
	r.Lock()
	defer r.Unlock()
	for pattern, resourcer := range resourcerMap {
		if _, exists := r.dynamicResourcers[pattern]; exists {
			return fmt.Errorf("dynamic resourcer for resource type %s already exists", pattern)
		}
		r.dynamicResourcers[pattern] = resourcer
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
func (r *resourcerManager[ClientT]) GetResourcer(
	resourceType string,
) (types.Resourcer[ClientT], error) {
	r.RLock()
	defer r.RUnlock()
	resourcer, exists := r.store[resourceType]
	if !exists {
		return nil, fmt.Errorf("resourcer for resource type %s does not exist", resourceType)
	}
	return resourcer, nil
}

// GetDynamicResourcer returns a dynamic resourcer to use for fetching a resource, if it exists.
// TODO: convert to trie structure for specificity, for now we'll just do first match.
func (r *resourcerManager[ClientT]) GetDynamicResourcer(
	resourceType string,
) (types.DynamicResourcer[ClientT], error) {
	r.RLock()
	defer r.RUnlock()
	for pattern, resourcer := range r.dynamicResourcers {
		if match(pattern, resourceType) {
			return resourcer, nil
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
