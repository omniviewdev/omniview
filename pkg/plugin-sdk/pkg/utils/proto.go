package utils

import (
	"encoding/json"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/anypb"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

func ConvertInterfaceToAny(v interface{}) (*anypb.Any, error) {
	anyValue := &anypb.Any{}
	bytes, _ := json.Marshal(v)
	bytesValue := &wrapperspb.BytesValue{
		Value: bytes,
	}
	err := anypb.MarshalFrom(anyValue, bytesValue, proto.MarshalOptions{})
	return anyValue, err
}

func ConvertAnyToInterface(anyValue *anypb.Any) (interface{}, error) {
	var value interface{}
	bytesValue := &wrapperspb.BytesValue{}
	err := anypb.UnmarshalTo(anyValue, bytesValue, proto.UnmarshalOptions{})
	if err != nil {
		return value, err
	}
	uErr := json.Unmarshal(bytesValue.GetValue(), &value)
	if uErr != nil {
		return value, uErr
	}
	return value, nil
}
