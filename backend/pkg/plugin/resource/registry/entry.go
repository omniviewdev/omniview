package registry

import (
	"time"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// ResourceEntry stores provider-neutral identity and route-local projection metadata.
// Incarnation remains optional provider evidence, never synthesized from metadata.
type ResourceEntry struct {
	PluginID  string
	Reference resourcev2.ResourceReference
	Route     resourcev2.AccessRoute
	Labels    map[string]string
	CreatedAt time.Time
}

// EntryKey returns canonical identity only. Store ownership and access route are
// separate projection keys and never grant permission to merge observations.
// Invalid addresses have no key and must not be admitted to the registry.
func (e ResourceEntry) EntryKey() string {
	key, err := CanonicalAddressKey(e.Reference.Address)
	if err != nil {
		return ""
	}
	return key
}
