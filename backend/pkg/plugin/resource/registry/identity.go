package registry

import (
	"bytes"
	"encoding/json"
	"sort"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// CanonicalAddressKey encodes the exact section 1 address tuple. Strings remain
// opaque: no splitting, Unicode normalization, case folding, or path cleaning.
// Equality is identity only, not authorization or permission to share cached data.
func CanonicalAddressKey(address resourcev2.ResourceAddress) (string, error) {
	if err := resourcev2.ValidateAddress(address); err != nil {
		return "", err
	}
	scope := append([]resourcev2.ScopeEntry(nil), address.Scope...)
	sort.Slice(scope, func(i, j int) bool { return scope[i].Dimension < scope[j].Dimension })
	pairs := make([][2]string, len(scope))
	for i, entry := range scope {
		pairs[i] = [2]string{entry.Dimension, entry.Value}
	}
	tuple := [6]any{"omniview.address.v1", address.Provider, address.Authority, address.Type, pairs, address.ID}
	var data bytes.Buffer
	encoder := json.NewEncoder(&data)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(tuple); err != nil {
		return "", err
	}
	return string(bytes.TrimSuffix(data.Bytes(), []byte{'\n'})), nil
}
