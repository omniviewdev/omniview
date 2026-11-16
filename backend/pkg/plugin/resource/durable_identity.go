package resource

import (
	"encoding/json"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// durableFingerprintKeyVersion tags the plugin-namespaced fingerprint key encoding.
const durableFingerprintKeyVersion = "omniview.environment-fingerprint.v1"

// DurableIdentity is the history and correlation identity of one observed
// object. It is evidence, never authorization and never access.
//
// Authorization, consent, MCP call binding, epoch fencing and reference currency
// keep using the host-issued authority in resourcev2.ResourceAddress and
// registry.CanonicalAddressKey. That authority is deliberately retired when a
// connection stops, when its endpoint or credentials change, and on the first
// catalog observation after a restart, so a grant, a pin or a captured call can
// never be replayed against another target. DurableIdentity survives all of those
// events by construction and must therefore never be accepted where an authority
// is required.
//
// Environment equality never grants access. A reader may see history for a
// population (environment, resource type, scope) only if the reader's own current
// route is permitted to read that type and scope now; equal identities never
// permit sharing a body, cache, grant or projection between routes. A consumer
// should record which route and authority observed each fact.
//
// The environment is a set of fingerprints and a connection declares only what
// its caller can read, so the identity carries the set rather than one value. A
// store resolves environments from the strong fingerprints (FingerprintKeys),
// merging every record that shares one and never merging across an exclusive
// conflict. The host stamps PluginID, so a plugin can name only its own
// environments: the same fingerprint declared by another plugin lands in that
// plugin's namespace.
type DurableIdentity struct {
	PluginID  string
	Reference resourcev2.DurableReference
}

// ObjectKey is the canonical key of the object inside its environment, without
// its incarnation.
func (d DurableIdentity) ObjectKey() (string, error) {
	return d.Reference.Address.Key()
}

// FingerprintKeys returns one canonical key per strong fingerprint, namespaced by
// plugin. Weak fingerprints are hints and never key an environment.
func (d DurableIdentity) FingerprintKeys() ([]string, error) {
	if d.PluginID == "" {
		return nil, resourcev2.NewError("INVALID_REQUEST", "A durable identity requires its plugin.")
	}
	strong := resourcev2.StrongEnvironment(d.Reference.Environment)
	keys := make([]string, 0, len(strong))
	for _, fingerprint := range strong {
		key, err := json.Marshal([]string{durableFingerprintKeyVersion, d.PluginID, fingerprint.Scheme, fingerprint.ID})
		if err != nil {
			return nil, err
		}
		keys = append(keys, string(key))
	}
	return keys, nil
}

// SameObject reports whether other observes the same object: the same plugin, the
// same object key, and the same environment (resourcev2.SameEnvironment). The
// incarnation is ignored, since it distinguishes versions of one identity. It is
// false when either side is not a valid identity.
func (d DurableIdentity) SameObject(other DurableIdentity) bool {
	if d.PluginID == "" || d.PluginID != other.PluginID {
		return false
	}
	key, err := d.ObjectKey()
	if err != nil {
		return false
	}
	otherKey, err := other.ObjectKey()
	if err != nil {
		return false
	}
	return key == otherKey && resourcev2.SameEnvironment(d.Reference.Environment, other.Reference.Environment)
}

// durableIdentity derives the durable identity of reference from the environment
// that descriptor, an admitted catalog type, declares. ok is false, with no
// error, when the type declares no strong fingerprint: its objects have no
// durable identity and must not be given one.
func durableIdentity(
	pluginID string, descriptor resourcev2.ResourceType, reference resourcev2.ResourceReference,
) (DurableIdentity, bool, error) {
	var none DurableIdentity
	if !resourcev2.HasStrongEnvironment(descriptor.Environment) {
		return none, false, nil
	}
	if pluginID == "" || descriptor.Type != reference.Address.Type {
		return none, false, resourcev2.NewError(
			"INVALID_REQUEST", "The reference does not belong to the type that declared the environment.")
	}
	durable, err := resourcev2.NewDurableReference(descriptor.Environment, reference)
	if err != nil {
		return none, false, err
	}
	return DurableIdentity{PluginID: pluginID, Reference: durable}, true, nil
}

// durableIdentity derives the durable identity of one of this session's members.
// The environment comes from the descriptor the session was bound to when it
// opened, the same admitted catalog observation that issued its authority. The
// SDK source contract retires a session whose type stops declaring the same
// environment, so it cannot change for the life of the session. A graph ingest
// hook that runs at the commit point already holds that descriptor in its frame
// context and may use durableIdentity directly.
func (s *sourceSession) durableIdentity(reference resourcev2.ResourceReference) (DurableIdentity, bool, error) {
	binding, ok := s.ctx.Value(sourceBindingKey{}).(sourceBinding)
	if !ok {
		var none DurableIdentity
		return none, false, nil
	}
	return durableIdentity(s.pluginID, binding.Descriptor, reference)
}
