// Package leasewire implements bounded result-lease delivery independently of
// execution and the Wails transport.
package leasewire

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/query"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

type OpenQueryLeaseRequest struct {
	RequestID string          `json:"requestId"`
	Query     query.QuerySpec `json:"query"`
	Refresh   *bool           `json:"refresh,omitempty"`
}
type OpenQueryLeaseResponse struct {
	LeaseID string `json:"leaseId"`
}
type QueryLeaseControl struct {
	Kind       string  `json:"kind"`
	Generation *string `json:"generation,omitempty"`
}
type ControlQueryLeaseRequest struct {
	LeaseID string            `json:"leaseId"`
	Control QueryLeaseControl `json:"control"`
}
// ControlQueryLeaseResponse encodes the contract's response union.
// Event is a single already-validated frame returned by BeginDrain.
type ControlQueryLeaseResponse struct {
	Kind       string
	Generation *string
	Accepted   *bool
	Event      json.RawMessage
}

func (r ControlQueryLeaseResponse) MarshalJSON() ([]byte, error) {
	switch r.Kind {
	case "attach":
		if r.Generation == nil || *r.Generation == "" || r.Accepted != nil || r.Event != nil {
			return nil, ErrInvalid
		}
		return json.Marshal(struct {
			Kind       string `json:"kind"`
			Generation string `json:"generation"`
		}{r.Kind, *r.Generation})
	case "recover":
		if r.Accepted == nil || !*r.Accepted || r.Generation != nil || r.Event != nil {
			return nil, ErrInvalid
		}
		return json.Marshal(struct {
			Kind     string `json:"kind"`
			Accepted bool   `json:"accepted"`
		}{r.Kind, true})
	case "drain":
		if r.Generation != nil || r.Accepted != nil || (r.Event != nil && !json.Valid(r.Event)) {
			return nil, ErrInvalid
		}
		return json.Marshal(struct {
			Kind  string          `json:"kind"`
			Event json.RawMessage `json:"event"`
		}{r.Kind, r.Event})
	default:
		return nil, ErrInvalid
	}
}

type CloseQueryLeaseRequest struct {
	LeaseID string `json:"leaseId"`
}
type CloseQueryLeaseResponse struct {
	Closed bool `json:"closed"`
}
type ResultProvenance struct {
	Source   string `json:"source"`
	Coverage string `json:"coverage"`
	Stale    bool   `json:"stale"`
}
type ProjectedValue struct {
	State string            `json:"state"`
	Value *resourcev2.Value `json:"value,omitempty"`
}
type ResultRow struct {
	Key            string                       `json:"key"`
	TargetID       string                       `json:"targetId"`
	Resource       resourcev2.ResourceReference `json:"resource"`
	Representation query.RepresentationSelector `json:"representation"`
	Provenance     ResultProvenance             `json:"provenance"`
	Values         map[string]ProjectedValue    `json:"values"`
}
type ResultCount struct {
	Kind  string  `json:"kind"`
	Value *string `json:"value,omitempty"`
}
type ResultMetadata struct {
	Coverage     string      `json:"coverage"`
	Limitations  []string    `json:"limitations"`
	Freshness    string      `json:"freshness"`
	Count        ResultCount `json:"count"`
	Continuation *string     `json:"continuation,omitempty"`
}
type ResultChange struct {
	Kind  string     `json:"kind"`
	Index *int       `json:"index,omitempty"`
	Key   *string    `json:"key,omitempty"`
	Row   *ResultRow `json:"row,omitempty"`
}
type ResultDataPayload struct {
	Kind     string         `json:"kind"`
	Rows     []ResultRow    `json:"rows,omitempty"`
	Changes  []ResultChange `json:"changes,omitempty"`
	Metadata ResultMetadata `json:"metadata"`
}
type ResultDataFrame struct {
	Lane       string            `json:"lane"`
	LeaseID    string            `json:"leaseId"`
	Generation string            `json:"generation"`
	Sequence   string            `json:"sequence"`
	Payload    ResultDataPayload `json:"payload"`
}
type ResultControlPayload struct {
	Kind           string             `json:"kind"`
	Generation     *string            `json:"generation,omitempty"`
	NextGeneration *string            `json:"nextGeneration,omitempty"`
	Reason         *string            `json:"reason,omitempty"`
	State          *string            `json:"state,omitempty"`
	Error          *apperror.AppError `json:"error,omitempty"`
}
type ResultControlFrame struct {
	Lane    string               `json:"lane"`
	LeaseID string               `json:"leaseId"`
	Payload ResultControlPayload `json:"payload"`
}
type QueryLeaseDoorbell struct {
	LeaseID string `json:"leaseId"`
}

var ErrInvalid = errors.New("invalid lease frame")

func decimal(s string) bool {
	if s == "" || (len(s) > 1 && s[0] == '0') {
		return false
	}
	_, e := strconv.ParseUint(s, 10, 64)
	if e != nil {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}
func oneOf(s string, values ...string) bool {
	for _, v := range values {
		if s == v {
			return true
		}
	}
	return false
}
func (v ProjectedValue) valid() bool {
	return (v.State == "value" && v.Value != nil) || (oneOf(v.State, "absent", "null") && v.Value == nil)
}
func (r ResultRow) valid() bool {
	if r.Key == "" || r.TargetID == "" || r.Provenance.Source == "" || !oneOf(r.Provenance.Coverage, "complete", "partial", "unknown") || r.Values == nil || r.Representation.ID == "" || r.Representation.Revision == "" {
		return false
	}
	for _, v := range r.Values {
		if !v.valid() {
			return false
		}
	}
	return true
}
func (m ResultMetadata) valid() bool {
	if !oneOf(m.Coverage, "complete", "partial", "unknown") || !oneOf(m.Freshness, "current", "snapshot", "stale") || m.Limitations == nil {
		return false
	}
	if m.Count.Kind == "unknown" {
		return m.Count.Value == nil
	}
	return oneOf(m.Count.Kind, "exact", "estimate") && m.Count.Value != nil && decimal(*m.Count.Value)
}
func (c ResultChange) valid() bool {
	switch c.Kind {
	case "enter":
		return c.Index != nil && *c.Index >= 0 && c.Row != nil && c.Row.valid() && c.Key == nil
	case "update":
		return c.Key != nil && *c.Key != "" && c.Row != nil && c.Row.valid() && c.Row.Key == *c.Key && c.Index == nil
	case "leave", "delete":
		return c.Key != nil && *c.Key != "" && c.Row == nil && c.Index == nil
	case "move":
		return c.Key != nil && *c.Key != "" && c.Index != nil && *c.Index >= 0 && c.Row == nil
	}
	return false
}

// MarshalJSON preserves empty arrays and rejects impossible union variants.
func (p ResultDataPayload) MarshalJSON() ([]byte, error) {
	if !p.Metadata.valid() {
		return nil, ErrInvalid
	}
	switch p.Kind {
	case "open":
		if p.Rows == nil || p.Changes != nil || len(p.Rows) > 512 {
			return nil, ErrInvalid
		}
		for _, r := range p.Rows {
			if !r.valid() {
				return nil, ErrInvalid
			}
		}
		return json.Marshal(struct {
			Kind     string         `json:"kind"`
			Rows     []ResultRow    `json:"rows"`
			Metadata ResultMetadata `json:"metadata"`
		}{p.Kind, p.Rows, p.Metadata})
	case "changes":
		if p.Changes == nil || p.Rows != nil || len(p.Changes) > 128 {
			return nil, ErrInvalid
		}
		for _, c := range p.Changes {
			if !c.valid() {
				return nil, ErrInvalid
			}
		}
		return json.Marshal(struct {
			Kind     string         `json:"kind"`
			Changes  []ResultChange `json:"changes"`
			Metadata ResultMetadata `json:"metadata"`
		}{p.Kind, p.Changes, p.Metadata})
	}
	return nil, ErrInvalid
}
func (f ResultDataFrame) encode() ([]byte, error) {
	if f.Lane != "data" || f.LeaseID == "" || f.Generation == "" || !decimal(f.Sequence) || f.Sequence == "0" {
		return nil, ErrInvalid
	}
	return json.Marshal(f)
}
func (f ResultControlFrame) encode() ([]byte, error) {
	p := f.Payload
	if f.Lane != "control" || f.LeaseID == "" {
		return nil, ErrInvalid
	}
	switch p.Kind {
	case "reset":
		if p.Generation == nil || *p.Generation == "" || p.NextGeneration == nil || *p.NextGeneration == "" || *p.Generation == *p.NextGeneration || p.Reason == nil || !oneOf(*p.Reason, "gap", "overflow", "sourceInvalidated", "bindingChanged") || p.State != nil || p.Error != nil {
			return nil, ErrInvalid
		}
	case "control":
		if p.Generation == nil || *p.Generation == "" || p.State == nil || *p.State != "complete" || p.NextGeneration != nil || p.Reason != nil || p.Error != nil {
			return nil, ErrInvalid
		}
	case "close":
		if p.Generation != nil || p.NextGeneration != nil || p.State != nil || p.Reason == nil || !oneOf(*p.Reason, "closed", "cancelled", "failed", "accessInvalidated") {
			return nil, ErrInvalid
		}
		if p.Error != nil && *p.Reason != "failed" && *p.Reason != "accessInvalidated" {
			return nil, ErrInvalid
		}
	default:
		return nil, ErrInvalid
	}
	b, e := json.Marshal(f)
	if e != nil {
		return nil, fmt.Errorf("encode control: %w", e)
	}
	return b, nil
}
