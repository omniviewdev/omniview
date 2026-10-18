//go:build devcontrol

package devcontrol

import (
	"encoding/json"
	"reflect"
	"testing"

	pkgsettings "github.com/omniviewdev/plugin-sdk/settings"
)

func TestSettingTransportPreservesProviderNativeTypes(t *testing.T) {
	for _, test := range []struct {
		name   string
		schema pkgsettings.Setting
		raw    string
		want   any
	}{
		{"integer", pkgsettings.Setting{Type: pkgsettings.Integer}, "12", int(12)},
		{"float", pkgsettings.Setting{Type: pkgsettings.Float}, "12.5", float64(12.5)},
		{"toggle", pkgsettings.Setting{Type: pkgsettings.Toggle}, "true", true},
		{"numeric select", pkgsettings.Setting{Type: pkgsettings.Select, Value: int(1)}, "2", int(2)},
		{"numeric multiselect", pkgsettings.Setting{Type: pkgsettings.MultiSelect, Value: []int{1}}, "[2,3]", []int{2, 3}},
		{"text multiselect", pkgsettings.Setting{Type: pkgsettings.MultiSelect, Value: []string{"a"}}, "[\"b\"]", []string{"b"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := typedSettingValue(json.RawMessage(test.raw), test.schema)
			if err != nil || !reflect.DeepEqual(got, test.want) {
				t.Fatalf("value=%#v (%T) want=%#v (%T) err=%v", got, got, test.want, test.want, err)
			}
		})
	}
	for _, raw := range []string{"null", "1.5", "\"12\""} {
		if _, err := typedSettingValue(json.RawMessage(raw), pkgsettings.Setting{Type: pkgsettings.Integer}); err == nil {
			t.Fatalf("invalid integer accepted: %s", raw)
		}
	}
}
