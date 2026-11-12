package updater

import (
	"crypto/ed25519"
	"encoding/hex"
	"fmt"
	"strings"
)

// trustedKeysHex is set at build time with -ldflags -X.
var trustedKeysHex string

func trustedKeys() ([]ed25519.PublicKey, error) {
	if trustedKeysHex == "" {
		return nil, nil
	}
	var keys []ed25519.PublicKey
	for _, value := range strings.Split(trustedKeysHex, ",") {
		if len(value) != 64 || value != strings.ToLower(value) {
			return nil, fmt.Errorf("invalid updater public key")
		}
		key, err := hex.DecodeString(value)
		if err != nil || len(key) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("invalid updater public key")
		}
		keys = append(keys, ed25519.PublicKey(key))
	}
	return keys, nil
}
