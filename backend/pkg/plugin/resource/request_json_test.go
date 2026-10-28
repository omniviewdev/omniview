package resource

import (
	"encoding/json"
	"strings"
	"testing"

	resource "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHostReadWrapperJSONAdmission(t *testing.T) {
	target := resource.ReadTarget{Route: resource.AccessRoute{Connection: "conn-1"}, Provider: "native", Authority: "host-issued", Type: "objects", Representation: "native"}
	get := resource.GetRequest{Route: target.Route, Reference: canonicalTestRecord(target.Provider, target.Authority, target.Type, "opaque").Reference, Representation: target.Representation}
	wrappers := []struct {
		name     string
		request  any
		allocate func() any
	}{
		{"get", get, func() any { return &HostGetRequest{} }},
		{"enumerate", resource.EnumerateRequest{Target: target}, func() any { return &HostEnumerateRequest{} }},
		{"nativeQuery", resource.NativeQueryRequest{Target: target, Language: "native", Query: resource.Value{Kind: "null"}}, func() any { return &HostNativeQueryRequest{} }},
	}
	for _, wrapper := range wrappers {
		t.Run(wrapper.name, func(t *testing.T) {
			request, err := json.Marshal(wrapper.request)
			require.NoError(t, err)
			valid := `{"targetId":"label","request":` + string(request) + `}`
			require.NoError(t, json.Unmarshal([]byte(valid), wrapper.allocate()))
			cases := map[string]string{
				"duplicate targetId":     `{"targetId":"label","targetId":"other","request":` + string(request) + `}`,
				"duplicate request":      `{"targetId":"label","request":` + string(request) + `,"request":` + string(request) + `}`,
				"unknown wrapper member": strings.TrimSuffix(valid, "}") + `,"unknown":true}`,
				"unknown nested member":  strings.Replace(valid, `"route":{`, `"route":{"unknown":true,`, 1),
				"unpaired surrogate":     strings.Replace(valid, `"conn-1"`, `"\ud800"`, 1),
				"invalid UTF8":           strings.Replace(valid, "conn-1", string([]byte{0xff}), 1),
				"empty label":            strings.Replace(valid, `"targetId":"label"`, `"targetId":""`, 1),
			}
			for name, raw := range cases {
				t.Run(name, func(t *testing.T) {
					err := json.Unmarshal([]byte(raw), wrapper.allocate())
					require.Error(t, err)
					assert.Equal(t, "INVALID_REQUEST", resource.ErrorCode(err))
				})
			}
		})
	}
}

func TestHostGetJSONRejectsDuplicateReference(t *testing.T) {
	request := grpcGetRequest()
	encoded, err := json.Marshal(request)
	require.NoError(t, err)
	reference, err := json.Marshal(request.Reference)
	require.NoError(t, err)
	raw := strings.Replace(string(encoded), `"reference":`+string(reference), `"reference":`+string(reference)+`,"reference":`+string(reference), 1)
	var decoded HostGetRequest
	err = json.Unmarshal([]byte(`{"targetId":"label","request":`+raw+`}`), &decoded)
	require.Error(t, err)
	assert.Equal(t, "INVALID_REQUEST", resource.ErrorCode(err))
}

func TestResolveReferenceJSONRejectsAmbiguousInput(t *testing.T) {
	valid := `{"route":{"connection":"conn-1"},"type":"objects","scope":[],"id":"opaque/雪","representation":"native"}`
	var request ResolveReferenceRequest
	require.NoError(t, json.Unmarshal([]byte(valid), &request))
	assert.Equal(t, "opaque/雪", request.ID)
	for name, raw := range map[string]string{
		"duplicate id":       strings.Replace(valid, `"id":"opaque/雪"`, `"id":"opaque/雪","id":"other"`, 1),
		"unknown member":     strings.TrimSuffix(valid, "}") + `,"unknown":true}`,
		"unpaired surrogate": strings.Replace(valid, "opaque/雪", `\ud800`, 1),
		"invalid UTF8":       strings.Replace(valid, "opaque/雪", string([]byte{0xff}), 1),
	} {
		t.Run(name, func(t *testing.T) {
			var decoded ResolveReferenceRequest
			err := json.Unmarshal([]byte(raw), &decoded)
			require.Error(t, err)
			assert.Equal(t, "INVALID_REQUEST", resource.ErrorCode(err))
		})
	}
}
