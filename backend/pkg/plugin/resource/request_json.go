package resource

import (
	"bytes"
	"encoding/json"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// Validate raw JSON before ordinary decoding loses duplicate members or repairs
// malformed Unicode. Private method-free types avoid recursive unmarshalling;
// they are not alternate public DTOs or compatibility aliases.
func decodeHostRequest(data []byte, out any) error {
	if err := resourcev2.ValidateJSON(data); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	decoder.UseNumber()
	if err := decoder.Decode(out); err != nil {
		return resourcev2.NewError("INVALID_REQUEST", "Invalid host resource request.")
	}
	return nil
}

func (request *HostGetRequest) UnmarshalJSON(data []byte) error {
	type plain HostGetRequest
	var value plain
	if err := decodeHostRequest(data, &value); err != nil {
		return err
	}
	if err := validateTargetLabel(value.TargetID); err != nil {
		return err
	}
	if err := resourcev2.ValidateGetRequest(value.Request); err != nil {
		return err
	}
	*request = HostGetRequest(value)
	return nil
}
func (request *HostEnumerateRequest) UnmarshalJSON(data []byte) error {
	type plain HostEnumerateRequest
	var value plain
	if err := decodeHostRequest(data, &value); err != nil {
		return err
	}
	if err := validateTargetLabel(value.TargetID); err != nil {
		return err
	}
	if err := resourcev2.ValidateEnumerateRequest(value.Request); err != nil {
		return err
	}
	*request = HostEnumerateRequest(value)
	return nil
}
func (request *HostNativeQueryRequest) UnmarshalJSON(data []byte) error {
	type plain HostNativeQueryRequest
	var value plain
	if err := decodeHostRequest(data, &value); err != nil {
		return err
	}
	if err := validateTargetLabel(value.TargetID); err != nil {
		return err
	}
	if err := resourcev2.ValidateNativeQueryRequest(value.Request); err != nil {
		return err
	}
	*request = HostNativeQueryRequest(value)
	return nil
}
func (request *ResolveTargetRequest) UnmarshalJSON(data []byte) error {
	type plain ResolveTargetRequest
	var value plain
	if err := decodeHostRequest(data, &value); err != nil {
		return err
	}
	if err := resourcev2.ValidateScope(value.Scope); err != nil {
		return err
	}
	*request = ResolveTargetRequest(value)
	return nil
}
func (request *ResolveReferenceRequest) UnmarshalJSON(data []byte) error {
	type plain ResolveReferenceRequest
	var value plain
	if err := decodeHostRequest(data, &value); err != nil {
		return err
	}
	*request = ResolveReferenceRequest(value)
	return nil
}
func (request *HostSubscription) UnmarshalJSON(data []byte) error {
	type plain HostSubscription
	var value plain
	if err := decodeHostRequest(data, &value); err != nil {
		return err
	}
	if err := validateTargetLabel(value.TargetID); err != nil {
		return err
	}
	if err := resourcev2.ValidateEnumerateRequest(resourcev2.EnumerateRequest{Target: value.Target}); err != nil {
		return err
	}
	*request = HostSubscription(value)
	return nil
}
