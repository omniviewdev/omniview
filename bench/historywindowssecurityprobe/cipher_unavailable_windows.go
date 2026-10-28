//go:build windows && !cgo

package main

import "errors"

func requireCipherSupport() error {
	return errors.New("encrypted Windows proof requires CGO and the pinned SQLCipher build; run native-windows.sh")
}

// Unsupported builds never report the vault-only subset as encrypted acceptance.
func encryptedProof(root, user, target string, key []byte, result map[string]any) error {
	return requireCipherSupport()
}
