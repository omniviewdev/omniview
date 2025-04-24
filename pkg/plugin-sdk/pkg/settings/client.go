package settings

import (
	"context"
	"fmt"

	"github.com/omniviewdev/settings"
	"google.golang.org/protobuf/types/known/anypb"
	"google.golang.org/protobuf/types/known/emptypb"

	"github.com/omniviewdev/plugin-sdk/proto"
)

type Client struct {
	client proto.SettingsPluginClient
}

var _ Provider = (*Client)(nil)

func (c *Client) Values() map[string]any {
	resp, err := c.client.ListSettings(context.Background(), &emptypb.Empty{})
	if err != nil {
		// we should never error here since the receiver never emits one
		return nil
	}

	m := make(map[string]any)
	for k, v := range resp.GetSettings() {
		value, err := ConvertAnyToInterface(v.GetValue())
		if err != nil {
			continue
		}
		key := fmt.Sprintf("%s.%s", k, v.GetId())
		m[key] = value
	}

	return m
}

func (c *Client) ListSettings() map[string]settings.Setting {
	resp, err := c.client.ListSettings(context.Background(), &emptypb.Empty{})
	if err != nil {
		// we should never error here since the receiver never emits one
		return nil
	}

	m := make(map[string]settings.Setting)
	for k, v := range resp.GetSettings() {
		m[k] = FromProtoSetting(v)
	}

	return m
}

func (c *Client) GetSetting(id string) (settings.Setting, error) {
	resp, err := c.client.GetSetting(context.Background(), &proto.GetSettingRequest{Id: id})
	if err != nil {
		return settings.Setting{}, err
	}
	return FromProtoSetting(resp), nil
}

func (c *Client) GetSettingValue(id string) (any, error) {
	resp, err := c.client.GetSettingValue(
		context.Background(),
		&proto.GetSettingValueRequest{Id: id},
	)
	if err != nil {
		return nil, err
	}
	return resp.GetValue(), nil
}

func (c *Client) SetSetting(id string, value any) error {
	val, err := ConvertInterfaceToAny(value)
	if err != nil {
		return err
	}
	_, err = c.client.SetSetting(context.Background(), &proto.SetSettingRequest{Id: id, Value: val})
	return err
}

func (c *Client) SetSettings(settings map[string]any) error {
	req := &proto.SetSettingsRequest{
		Settings: make(map[string]*anypb.Any),
	}

	for k, v := range settings {
		val, err := ConvertInterfaceToAny(v)
		if err != nil {
			return err
		}
		req.Settings[k] = val
	}
	_, err := c.client.SetSettings(context.Background(), req)
	return err
}
