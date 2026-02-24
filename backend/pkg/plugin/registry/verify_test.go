package registry

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"testing"
)

// swapPublicKey replaces the package-level public key for testing and returns a restore function.
func swapPublicKey(t *testing.T, pub ed25519.PublicKey) {
	t.Helper()
	original := omniviewPublicKey
	omniviewPublicKey = pub
	t.Cleanup(func() { omniviewPublicKey = original })
}

func TestVerifyValidSignature(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	swapPublicKey(t, pub)

	checksum := "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	sig := ed25519.Sign(priv, []byte(checksum))
	sigB64 := base64.StdEncoding.EncodeToString(sig)

	if err := VerifyArtifactSignature(checksum, sigB64); err != nil {
		t.Fatalf("expected valid signature to pass: %v", err)
	}
}

func TestVerifyEmptySignature(t *testing.T) {
	err := VerifyArtifactSignature("checksum", "")
	if err != ErrUnsignedArtifact {
		t.Fatalf("expected ErrUnsignedArtifact, got: %v", err)
	}
}

func TestVerifyWrongKey(t *testing.T) {
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	otherPub, _, _ := ed25519.GenerateKey(rand.Reader)
	swapPublicKey(t, otherPub)

	checksum := "abc123"
	sig := ed25519.Sign(priv, []byte(checksum))
	sigB64 := base64.StdEncoding.EncodeToString(sig)

	if err := VerifyArtifactSignature(checksum, sigB64); err == nil {
		t.Fatal("expected verification to fail with wrong key")
	}
}

func TestVerifyTamperedChecksum(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	swapPublicKey(t, pub)

	sig := ed25519.Sign(priv, []byte("original"))
	sigB64 := base64.StdEncoding.EncodeToString(sig)

	if err := VerifyArtifactSignature("tampered", sigB64); err == nil {
		t.Fatal("expected verification to fail for tampered checksum")
	}
}

func TestVerifyMalformedBase64(t *testing.T) {
	pub, _, _ := ed25519.GenerateKey(rand.Reader)
	swapPublicKey(t, pub)

	err := VerifyArtifactSignature("checksum", "not-valid-base64!!!")
	if err == nil {
		t.Fatal("expected error for malformed base64")
	}
}

func TestPublicKeyHexDecode(t *testing.T) {
	pub, _, _ := ed25519.GenerateKey(rand.Reader)
	h := hex.EncodeToString(pub)
	decoded, err := hex.DecodeString(h)
	if err != nil {
		t.Fatal(err)
	}
	if len(decoded) != ed25519.PublicKeySize {
		t.Fatalf("expected %d bytes, got %d", ed25519.PublicKeySize, len(decoded))
	}
}
