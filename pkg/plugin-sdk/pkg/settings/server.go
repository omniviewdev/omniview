package settings

import (
	"context"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/omniviewdev/plugin-sdk/proto"
)

type SettingsPluginServer struct {
	// This is the real implementation
	Impl Provider
}

func (s *SettingsPluginServer) ListSettings(
	_ context.Context,
	_ *emptypb.Empty,
) (*proto.ListSettingsResponse, error) {
	resp := s.Impl.ListSettings()

	settings := make(map[string]*proto.Setting)
	for k, v := range resp {
		settings[k] = ToProtoSetting(v)
	}

	return &proto.ListSettingsResponse{
		Settings: settings,
	}, nil
}

func (s *SettingsPluginServer) GetSetting(
	_ context.Context,
	in *proto.GetSettingRequest,
) (*proto.Setting, error) {
	resp, err := s.Impl.GetSetting(in.GetId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get setting: %s", err.Error())
	}

	return ToProtoSetting(resp), nil
}

func (s *SettingsPluginServer) GetSettingValue(
	_ context.Context,
	in *proto.GetSettingValueRequest,
) (*proto.GetSettingValueResponse, error) {
	resp, err := s.Impl.GetSettingValue(in.GetId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get setting value: %s", err.Error())
	}

	value, err := ConvertInterfaceToAny(resp)
	if err != nil {
		return nil, status.Errorf(
			codes.Internal,
			"failed to convert setting value: %s",
			err.Error(),
		)
	}

	return &proto.GetSettingValueResponse{
		Value: value,
	}, nil
}

func (s *SettingsPluginServer) SetSetting(
	_ context.Context,
	in *proto.SetSettingRequest,
) (*emptypb.Empty, error) {
	value, err := ConvertAnyToInterface(in.GetValue())
	if err != nil {
		return nil, status.Errorf(
			codes.Internal,
			"failed to convert setting value: %s",
			err.Error(),
		)
	}

	if err = s.Impl.SetSetting(in.GetId(), value); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to set setting: %s", err.Error())
	}
	return &emptypb.Empty{}, nil
}

func (s *SettingsPluginServer) SetSettings(
	_ context.Context,
	in *proto.SetSettingsRequest,
) (*emptypb.Empty, error) {
	values := make(map[string]interface{})
	for k, v := range in.GetSettings() {
		value, err := ConvertAnyToInterface(v)
		if err != nil {
			return nil, status.Errorf(
				codes.Internal,
				"failed to convert setting value: %s",
				err.Error(),
			)
		}
		values[k] = value
	}

	if err := s.Impl.SetSettings(values); err != nil {
		return nil, status.Errorf(codes.Internal, "failed to set settings: %s", err.Error())
	}
	return &emptypb.Empty{}, nil
}
