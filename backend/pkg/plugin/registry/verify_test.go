package registry

import (
	"slices"
	"testing"

	regclient "github.com/omniviewdev/registry"
)

func TestTrustedMarketplaceKeysAreTrusted(t *testing.T) {
	trusted := regclient.TrustedPublicKeys()
	if trusted[0] != regclient.OmniviewPublicKeyHex {
		t.Fatalf("primary key %q is not first in %v", regclient.OmniviewPublicKeyHex, trusted)
	}
	for _, key := range trustedMarketplaceKeys {
		if !slices.Contains(trusted, key) {
			t.Errorf("marketplace key %s is not trusted (trusted: %v)", key, trusted)
		}
	}
}
