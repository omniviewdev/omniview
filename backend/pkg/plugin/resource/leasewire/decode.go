package leasewire

import (
	"bytes"
	"encoding/json"
	"io"
	"reflect"
	"strings"

	"github.com/omniviewdev/omniview/backend/pkg/plugin/resource/query"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

const MaxRequestBytes = 65536

func decodeStrict(data []byte, dst any) error {
	if len(data) > MaxRequestBytes {
		return ErrFrameTooLarge
	}
	if err := resourcev2.ValidateJSON(data); err != nil {
		return ErrInvalid
	}
	// encoding/json matches struct fields case-insensitively. Enforce the
	// contract's exact spelling before decoding the envelope.
	var members map[string]json.RawMessage
	if err := json.Unmarshal(data, &members); err != nil || members == nil {
		return ErrInvalid
	}
	typ := reflect.TypeOf(dst)
	if typ.Kind() != reflect.Pointer || typ.Elem().Kind() != reflect.Struct {
		return ErrInvalid
	}
	typ = typ.Elem()
	for key := range members {
		found := false
		for i := range typ.NumField() {
			name, _, _ := strings.Cut(typ.Field(i).Tag.Get("json"), ",")
			if name == key {
				found = true
				break
			}
		}
		if !found {
			return ErrInvalid
		}
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return ErrInvalid
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		return ErrInvalid
	}
	return nil
}

// DecodeOpenQueryLeaseRequest validates the C08 envelope and the P13 query.
func DecodeOpenQueryLeaseRequest(data []byte) (OpenQueryLeaseRequest, error) {
	var raw struct {
		RequestID *string         `json:"requestId"`
		Query     json.RawMessage `json:"query"`
		Refresh   json.RawMessage `json:"refresh"`
	}
	if err := decodeStrict(data, &raw); err != nil {
		return OpenQueryLeaseRequest{}, err
	}
	if raw.RequestID == nil || *raw.RequestID == "" || len(raw.Query) == 0 {
		return OpenQueryLeaseRequest{}, ErrInvalid
	}
	q, err := query.Decode(raw.Query)
	if err != nil {
		return OpenQueryLeaseRequest{}, err
	}
	out := OpenQueryLeaseRequest{RequestID: *raw.RequestID, Query: q}
	if raw.Refresh != nil {
		if string(raw.Refresh) != "true" {
			return OpenQueryLeaseRequest{}, ErrInvalid
		}
		value := true
		out.Refresh = &value
	}
	return out, nil
}

// DecodeControlQueryLeaseRequest rejects unknown, null and cross-variant fields.
func DecodeControlQueryLeaseRequest(data []byte) (ControlQueryLeaseRequest, error) {
	var raw struct {
		LeaseID *string         `json:"leaseId"`
		Control json.RawMessage `json:"control"`
	}
	if err := decodeStrict(data, &raw); err != nil {
		return ControlQueryLeaseRequest{}, err
	}
	if raw.LeaseID == nil || *raw.LeaseID == "" || len(raw.Control) == 0 {
		return ControlQueryLeaseRequest{}, ErrInvalid
	}
	var c struct {
		Kind       *string         `json:"kind"`
		Generation json.RawMessage `json:"generation"`
	}
	if err := decodeStrict(raw.Control, &c); err != nil || c.Kind == nil {
		return ControlQueryLeaseRequest{}, ErrInvalid
	}
	out := ControlQueryLeaseRequest{LeaseID: *raw.LeaseID, Control: QueryLeaseControl{Kind: *c.Kind}}
	switch *c.Kind {
	case "attach", "drain":
		if c.Generation != nil {
			return ControlQueryLeaseRequest{}, ErrInvalid
		}
	case "recover":
		var g string
		if len(c.Generation) == 0 || json.Unmarshal(c.Generation, &g) != nil || g == "" {
			return ControlQueryLeaseRequest{}, ErrInvalid
		}
		out.Control.Generation = &g
	default:
		return ControlQueryLeaseRequest{}, ErrInvalid
	}
	return out, nil
}

func DecodeCloseQueryLeaseRequest(data []byte) (CloseQueryLeaseRequest, error) {
	var raw struct {
		LeaseID *string `json:"leaseId"`
	}
	if err := decodeStrict(data, &raw); err != nil {
		return CloseQueryLeaseRequest{}, err
	}
	if raw.LeaseID == nil || *raw.LeaseID == "" {
		return CloseQueryLeaseRequest{}, ErrInvalid
	}
	return CloseQueryLeaseRequest{LeaseID: *raw.LeaseID}, nil
}
