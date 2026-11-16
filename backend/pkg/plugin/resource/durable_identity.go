package resource

import (
	"encoding/json"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// durableIdentityKeyVersion tags the plugin-namespaced key encoding.
const durableIdentityKeyVersion = "omniview.durable-identity.v1"

// DurableIdentity is the history and correlation identity of one observed
// object. It is evidence, never authorization.
//
// Authorization, consent, MCP call binding, epoch fencing and reference currency
// keep using the host-issued authority in resourcev2.ResourceAddress and
// registry.CanonicalAddressKey. That authority is deliberately retired when a
// connection stops, when its endpoint or credentials change, and on the first
// catalog observation after a restart, so a grant, a pin or a captured call can
// never be replayed against another target. DurableIdentity survives all of
// those events by construction and must therefore never be accepted where an
// authority is required, and equal identities never permit sharing a body, cache,
// grant or projection between routes. A consumer that serves history must still
// authorize every read through the current route, and should record which route
// and authority observed each fact.
//
// The host stamps PluginID, so a plugin can name only its own environments. A
// plugin that declares another plugin's environment value still lands in its own
// namespace.
type DurableIdentity struct {
	PluginID  string
	Reference resourcev2.DurableReference
}

// Key is one canonical string for the identity without its incarnation, scoped
// to the plugin that declared the environment.
func (d DurableIdentity) Key() (string, error) {
	address, err := d.Reference.Address.Key()
	if err != nil {
		return "", err
	}
	if d.PluginID == "" {
		return "", resourcev2.NewError("INVALID_REQUEST", "A durable identity requires its plugin.")
	}
	key, err := json.Marshal([]string{durableIdentityKeyVersion, d.PluginID, address})
	if err != nil {
		return "", err
	}
	return string(key), nil
}

// durableIdentity derives the durable identity of reference from the environment
// that descriptor, an admitted catalog type, declares. ok is false, with no
// error, when the type declares no environment: its objects have no durable
// identity and must not be given one.
func durableIdentity(
	pluginID string, descriptor resourcev2.ResourceType, reference resourcev2.ResourceReference,
) (DurableIdentity, bool, error) {
	var none DurableIdentity
	if descriptor.Environment == nil {
		return none, false, nil
	}
	if pluginID == "" || descriptor.Type != reference.Address.Type {
		return none, false, resourcev2.NewError(
			"INVALID_REQUEST", "The reference does not belong to the type that declared the environment.")
	}
	durable, err := resourcev2.NewDurableReference(*descriptor.Environment, reference)
	if err != nil {
		return none, false, err
	}
	return DurableIdentity{PluginID: pluginID, Reference: durable}, true, nil
}

// durableIdentity derives the durable identity of one of this session's members.
// The environment comes from the descriptor the session was bound to when it
// opened, the same admitted catalog observation that issued its authority, and
// it cannot change for the life of the session: the SDK source contract retires
// a session whose type later declares another environment. A graph ingest hook
// that runs at the commit point already holds that descriptor in its frame
// context and may use durableIdentity directly.
func (s *sourceSession) durableIdentity(reference resourcev2.ResourceReference) (DurableIdentity, bool, error) {
	binding, ok := s.ctx.Value(sourceBindingKey{}).(sourceBinding)
	if !ok {
		var none DurableIdentity
		return none, false, nil
	}
	return durableIdentity(s.pluginID, binding.Descriptor, reference)
}
