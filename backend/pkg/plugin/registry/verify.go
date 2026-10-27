package registry

import (
	"fmt"

	regclient "github.com/omniviewdev/registry"
)

// Signature verification is done by the registry client (github.com/omniviewdev/registry/verify.go). It accepts
// artifacts signed by its primary key (injected at build time with
// -X github.com/omniviewdev/registry.OmniviewPublicKeyHex=…, or overridden by the developer.registry_public_key
// setting) or by any additional trusted key. The keys below are trusted in every build.

// trustedMarketplaceKeys are the signing keys of further marketplaces whose plugins the app installs.
var trustedMarketplaceKeys = []string{ //nolint:gochecknoglobals // fixed list
	// https://mkt.omniview.dev (self-hosted marketplace).
	"d3cbf3ecdddc060ad36f85f9621bb69c0b46f6dffedfba0bc0c09f6b5618c40e",
}

func init() {
	for _, key := range trustedMarketplaceKeys {
		if err := regclient.AddPublicKey(key); err != nil {
			panic(fmt.Sprintf("invalid trusted marketplace key %q: %v", key, err))
		}
	}
}
