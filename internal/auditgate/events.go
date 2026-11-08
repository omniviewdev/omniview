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
	// MaxEventMessageBytes bounds one /wails/events message the filter
	// inspects. Backend events can carry whole resource lists, so the bound
	// is generous; a larger message is dropped, never forwarded. A gateway
	// must also give its WebSocket connections a read limit of at least this
	// size (for coder/websocket: Conn.SetReadLimit), because the library
	// default is far smaller and closes the connection on a larger message.
	MaxEventMessageBytes = 32 << 20

	maxEventNameBytes = 512
	// eventMessageKeys is the number of fields of a Wails custom event: name,
	// data and sender.
	eventMessageKeys = 3
)

// MessageKind is the WebSocket message type of a message handed to
// FilterEventMessage. It mirrors the text and binary types of the WebSocket
// protocol without importing a WebSocket library.
type MessageKind int

// The WebSocket message types.
const (
	// MessageText is a text message. Wails sends every event as one.
	MessageText MessageKind = iota + 1
	// MessageBinary is a binary message. The host never sends one.
	MessageBinary
)

// EventReason explains an event filter outcome. Values are stable machine
// codes that are safe to log.
type EventReason string

// Event filter outcomes.
const (
	EventAllowed         EventReason = "allowed"
	EventDeniedByRule    EventReason = "denied_by_rule"
	EventNotAllowed      EventReason = "not_allowed"
	EventInvalidMessage  EventReason = "invalid_message"
	EventMessageTooLarge EventReason = "message_too_large"
	EventNotText         EventReason = "not_text"
)

// EventVerdict is the outcome of filtering one backend event message.
type EventVerdict struct {
	// Forward is true only when the message may be sent to the remote client.
	Forward bool
	Reason  EventReason
	// Name is the event name when the message parsed, otherwise empty.
	Name string
	// Rule is the table rule that decided the outcome. It is meaningful only
	// when Matched is true; an invalid message or an unlisted name (the
	// default drop) has no deciding rule.
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

// FilterEventMessage decides whether one message the host sent on the Wails
// event socket may be forwarded to the remote client. The payload must be a
// complete message: WebSocket libraries return whole messages, reassembled
// from however many frames the peer used, so the filter never sees a partial
// one. Only a text message holding the JSON of a Wails custom event,
// {"name":...,"data":...,"sender":...}, can pass. A binary message, an unknown
// kind, or text that is anything else is dropped, and a message is forwarded
// unchanged only when its name is allowed. The filter never closes the
// socket: dropping is the only negative outcome.
//
// Only the envelope is interpreted; the data payload is validated as JSON and
// skipped. Event messages flow from the trusted host to the client, so unlike
// request bodies they need no canonical re-serialization.
func (p *Policy) FilterEventMessage(kind MessageKind, payload []byte) EventVerdict {
	var none EventRule
	if kind != MessageText {
		return EventVerdict{Forward: false, Reason: EventNotText, Name: "", Rule: none, Matched: false}
	}
	if len(payload) > MaxEventMessageBytes {
		return EventVerdict{Forward: false, Reason: EventMessageTooLarge, Name: "", Rule: none, Matched: false}
	}
	name, err := parseEventMessage(payload)
	if err != nil {
		return EventVerdict{Forward: false, Reason: EventInvalidMessage, Name: "", Rule: none, Matched: false}
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

var errEventMessage = errors.New("invalid event message")

// parseEventMessage validates the event envelope and returns the event name.
func parseEventMessage(payload []byte) (string, error) {
	if len(payload) == 0 || !utf8.Valid(payload) {
		return "", errEventMessage
	}
	dec := json.NewDecoder(bytes.NewReader(payload))
	if token, err := dec.Token(); err != nil || token != json.Delim('{') {
		return "", errEventMessage
	}
	fields, err := readEventFields(dec)
	if err != nil {
		return "", err
	}
	if token, tokenErr := dec.Token(); tokenErr != nil || token != json.Delim('}') {
		return "", errEventMessage
	}
	if _, tokenErr := dec.Token(); !errors.Is(tokenErr, io.EOF) {
		return "", errEventMessage
	}
	name, ok := stringValue(fields["name"])
	if !ok || !validWireEventName(name) {
		return "", errEventMessage
	}
	if sender, present := fields["sender"]; present {
		if _, isString := stringValue(sender); !isString {
			return "", errEventMessage
		}
	}
	return name, nil
}

// readEventFields reads the members of the event object, rejecting unknown
// and repeated keys. Values are validated as JSON but otherwise skipped.
func readEventFields(dec *json.Decoder) (map[string]json.RawMessage, error) {
	fields := make(map[string]json.RawMessage, eventMessageKeys)
	for dec.More() {
		token, err := dec.Token()
		if err != nil {
			return nil, errEventMessage
		}
		key, isString := token.(string)
		if !isString {
			return nil, errEventMessage
		}
		switch key {
		case "name", "data", "sender":
		default:
			return nil, errEventMessage
		}
		if _, dup := fields[key]; dup {
			return nil, errEventMessage
		}
		var raw json.RawMessage
		if err = dec.Decode(&raw); err != nil {
			return nil, errEventMessage
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
