package resource

import resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"

// ResourceProvider is the canonical provider-facing boundary. Catalog is the
// only required operation. Callers discover optional operation interfaces and
// qualified catalog support independently; transport messages never escape here.
type ResourceProvider interface {
	resourcev2.Provider
}
