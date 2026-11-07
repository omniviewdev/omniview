package auditgate

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"unicode"
	"unicode/utf8"
)

const (
	// MaxEventFrameBytes bounds one /wails/events frame the filter inspects.
	// Backend events can carry whole resource lists, so the bound is generous;
	// a larger frame is dropped, never forwarded.
	MaxEventFrameBytes = 32 << 20

	maxEventNameBytes = 512
	// eventFrameKeys is the number of fields of a Wails custom event: name,
	// data and sender.
	eventFrameKeys = 3
)

// EventReason explains an event filter outcome. Values are stable machine
// codes that are safe to log.
type EventReason string

// Event filter outcomes.
const (
	EventAllowed       EventReason = "allowed"
	EventDeniedByRule  EventReason = "denied_by_rule"
	EventNotAllowed    EventReason = "not_allowed"
	EventInvalidFrame  EventReason = "invalid_frame"
	EventFrameTooLarge EventReason = "frame_too_large"
)

// EventVerdict is the outcome of filtering one backend event frame.
type EventVerdict struct {
	// Forward is true only when the frame may be sent to the remote client.
	Forward bool
	Reason  EventReason
	// Name is the event name when the frame parsed, otherwise empty.
	Name string
	// Rule is the table rule that decided the outcome. It is meaningful only
	// when Matched is true; an invalid frame or an unlisted name (the default
	// drop) has no deciding rule.
	Rule    EventRule
	Matched bool
}

// ClassifyEvent applies the event rules to a name: a matching deny rule wins,
// then a matching allow rule, and any other name is denied. The returned rule
// is the one that decided and matched reports whether there was one; a name
// that no rule matches, or that is not a plausible event name, is denied by
// default and has no deciding rule.
func (p *Policy) ClassifyEvent(name string) (Decision, EventRule, bool) {
	var none EventRule
	if !validWireEventName(name) {
		return Deny, none, false
	}
	var allowed EventRule
	allowedFound := false
	for _, candidate := range p.events {
		if !candidate.matches(name) {
			continue
		}
		if candidate.Decision == Deny {
			return Deny, candidate, true
		}
		if !allowedFound {
			allowed, allowedFound = candidate, true
		}
	}
	if allowedFound {
		return Allow, allowed, true
	}
	return Deny, none, false
}

// FilterEventFrame decides whether one server-to-client frame of the Wails
// event socket may be forwarded. The frame is the JSON text of a Wails custom
// event, {"name":...,"data":...,"sender":...}. Anything that is not exactly
// that shape is dropped, and a frame is forwarded unchanged only when its
// name is allowed. The filter never closes the socket: dropping is the only
// negative outcome.
//
// Only the envelope is interpreted; the data payload is validated as JSON and
// skipped. Event frames flow from the trusted host to the client, so unlike
// request bodies they need no canonical re-serialization.
func (p *Policy) FilterEventFrame(frame []byte) EventVerdict {
	var none EventRule
	if len(frame) > MaxEventFrameBytes {
		return EventVerdict{Forward: false, Reason: EventFrameTooLarge, Name: "", Rule: none, Matched: false}
	}
	name, err := parseEventFrame(frame)
	if err != nil {
		return EventVerdict{Forward: false, Reason: EventInvalidFrame, Name: "", Rule: none, Matched: false}
	}
	decision, rule, matched := p.ClassifyEvent(name)
	switch {
	case decision == Allow:
		return EventVerdict{Forward: true, Reason: EventAllowed, Name: name, Rule: rule, Matched: true}
	case matched:
		return EventVerdict{Forward: false, Reason: EventDeniedByRule, Name: name, Rule: rule, Matched: true}
	default:
		return EventVerdict{Forward: false, Reason: EventNotAllowed, Name: name, Rule: none, Matched: false}
	}
}

var errEventFrame = errors.New("invalid event frame")

// parseEventFrame validates the frame envelope and returns the event name.
func parseEventFrame(frame []byte) (string, error) {
	if len(frame) == 0 || !utf8.Valid(frame) {
		return "", errEventFrame
	}
	dec := json.NewDecoder(bytes.NewReader(frame))
	if token, err := dec.Token(); err != nil || token != json.Delim('{') {
		return "", errEventFrame
	}
	fields, err := readEventFields(dec)
	if err != nil {
		return "", err
	}
	if token, tokenErr := dec.Token(); tokenErr != nil || token != json.Delim('}') {
		return "", errEventFrame
	}
	if _, tokenErr := dec.Token(); !errors.Is(tokenErr, io.EOF) {
		return "", errEventFrame
	}
	name, ok := stringValue(fields["name"])
	if !ok || !validWireEventName(name) {
		return "", errEventFrame
	}
	if sender, present := fields["sender"]; present {
		if _, isString := stringValue(sender); !isString {
			return "", errEventFrame
		}
	}
	return name, nil
}

// readEventFields reads the members of the event object, rejecting unknown
// and repeated keys. Values are validated as JSON but otherwise skipped.
func readEventFields(dec *json.Decoder) (map[string]json.RawMessage, error) {
	fields := make(map[string]json.RawMessage, eventFrameKeys)
	for dec.More() {
		token, err := dec.Token()
		if err != nil {
			return nil, errEventFrame
		}
		key, isString := token.(string)
		if !isString {
			return nil, errEventFrame
		}
		switch key {
		case "name", "data", "sender":
		default:
			return nil, errEventFrame
		}
		if _, dup := fields[key]; dup {
			return nil, errEventFrame
		}
		var raw json.RawMessage
		if err = dec.Decode(&raw); err != nil {
			return nil, errEventFrame
		}
		fields[key] = raw
	}
	return fields, nil
}

// validWireEventName accepts any non-empty, bounded name without control
// characters. Connection identifiers legitimately appear inside names and may
// contain spaces or slashes.
func validWireEventName(name string) bool {
	if name == "" || len(name) > maxEventNameBytes || !utf8.ValidString(name) {
		return false
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

// validEventName is the stricter check for rule names, which are static
// strings reviewed in the table.
func validEventName(name string) bool {
	if !validWireEventName(name) {
		return false
	}
	for _, r := range name {
		if unicode.IsSpace(r) {
			return false
		}
	}
	return true
}
