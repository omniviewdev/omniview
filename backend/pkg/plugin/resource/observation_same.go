package resource

import "maps"

// Same reports whether o and other retain one advertisement of one native
// route catalog: the same plugin generation, the same source epoch, the same
// route, the same catalog digest and the same authority resolutions.
//
// It is the equality the MCP relay needs to tell "the catalog did not change"
// from "this tool must be published again". It never compares an Observation
// by content with reflect.DeepEqual: an Observation reaches the live plugin
// generation (*pluginState: provider, backend, maps and a close error written
// under locks the caller does not hold) and the controller, and a content
// comparison would read them unlocked. Every field Same reads is therefore
// one of two kinds:
//
//   - A value copied into the Observation by ObserveCatalog and never written
//     afterwards: epoch, plugin, route, digest, and the authority resolutions
//     (a map built once in ObserveCatalog and only read since). Reading these
//     needs no lock.
//   - A pointer compared by identity and never dereferenced: the generation
//     (a retired generation is a different pointer, which is exactly what makes
//     a retained observation stale) and the controller.
//
// The per-scan discovery pointer is ignored: every ObserveCatalog call makes a
// new one, and what it holds that matters is the controller and the authority
// resolutions (compared) and the catalog (covered by the digest).
func (o Observation) Same(other Observation) bool {
	return o.admission.generation == other.admission.generation &&
		o.admission.epoch == other.admission.epoch &&
		o.plugin == other.plugin &&
		o.route == other.route &&
		o.digest == other.digest &&
		sameDiscovery(o.discovery, other.discovery)
}

func sameDiscovery(a, b *catalogDiscovery) bool {
	if a == b {
		return true
	}
	if a == nil || b == nil || a.controller != b.controller {
		return false
	}
	return maps.EqualFunc(a.authorities, b.authorities, sameAuthorityResolution)
}

func sameAuthorityResolution(a, b AuthorityResolution) bool {
	if a.Authority != b.Authority || a.Continuity != b.Continuity || a.Changed != b.Changed || len(a.Limitations) != len(b.Limitations) {
		return false
	}
	for i := range a.Limitations {
		if a.Limitations[i] != b.Limitations[i] {
			return false
		}
	}
	return true
}
