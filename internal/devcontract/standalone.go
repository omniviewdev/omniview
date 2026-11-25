package devcontract

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"io"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

// StandaloneVersion is private. Managed descriptors/requests remain v1 and
// public boot/backend identity remains schema1. Never substitute an InstanceID
// for a managed WorkspaceID.
const StandaloneVersion = 2

// StandaloneTarget identifies a claimed physical checkout. Its claim digest is
// an identity salt, not a credential. Validation is structural; the consumer
// must separately revalidate the actual claim under its stable lifecycle guard.
type StandaloneTarget struct {
	Kind        string `json:"kind"`
	InstanceID  string `json:"instanceID"`
	Checkout    string `json:"checkout"`
	ClaimDigest string `json:"claimDigest"`
}

func ValidStandaloneID(id string) bool {
	return strings.HasPrefix(id, "standalone-") && lowerHex(strings.TrimPrefix(id, "standalone-"), 32)
}

func lowerHex(value string, size int) bool {
	raw, err := hex.DecodeString(value)
	return err == nil && len(raw) == size && hex.EncodeToString(raw) == value
}

func (t StandaloneTarget) Validate() error {
	if t.Kind != "standalone" || !ValidStandaloneID(t.InstanceID) || !filepath.IsAbs(t.Checkout) || filepath.Clean(t.Checkout) != t.Checkout || filepath.Dir(t.Checkout) == t.Checkout || !lowerHex(t.ClaimDigest, 32) || strings.ContainsAny(t.Checkout, "\x00\r\n") {
		return Fail(2, "invalid_standalone_target", "standalone target requires a canonical checkout and private claim identity")
	}
	return nil
}

func validStandaloneGeneration(value string) bool {
	id, err := uuid.Parse(value)
	return err == nil && id != uuid.Nil && id.String() == value
}

// StandaloneRequest has no managed identity field. Its intentionally small
// operation set cannot enable the managed plugin/settings mutation adapters.
// Explicit stop belongs to the supervisor; host inspection grants no stop API.
type StandaloneRequest struct {
	ProtocolVersion int              `json:"protocolVersion"`
	RequestID       string           `json:"requestID"`
	Target          StandaloneTarget `json:"target"`
	Generation      string           `json:"generation"`
	Operation       string           `json:"operation"`
}

func (r StandaloneRequest) ValidateTarget(target StandaloneTarget, generation string, supervisor bool) error {
	if r.ProtocolVersion != StandaloneVersion || !validStandaloneGeneration(r.RequestID) || r.Target.Validate() != nil || target.Validate() != nil || !validStandaloneGeneration(generation) || !validStandaloneGeneration(r.Generation) {
		return Fail(2, "invalid_request", "invalid standalone v2 request")
	}
	if r.Target != target || r.Generation != generation {
		return Fail(4, "stale_target", "standalone target or generation does not match")
	}
	switch r.Operation {
	case "instance.inspect":
	case "session.stop":
		if !supervisor {
			return Fail(2, "unknown_operation", "stop is available only from the owning supervisor")
		}
	default:
		return Fail(2, "unknown_operation", "operation is not allowed for standalone development")
	}
	return nil
}

// DecodeStandaloneRequest rejects unknown/mixed variants, duplicate keys and
// trailing documents before returning a request. Request bodies reuse the
// existing 1 MiB control bound; that bound is not a performance guarantee.
func DecodeStandaloneRequest(input io.Reader) (StandaloneRequest, error) {
	var request StandaloneRequest
	raw, err := io.ReadAll(io.LimitReader(input, (1<<20)+1))
	if err != nil {
		return request, err
	}
	if len(raw) > 1<<20 {
		return request, Fail(2, "invalid_request", "standalone request exceeds the control body limit")
	}
	if err := uniqueJSON(raw); err != nil {
		return request, err
	}
	if err := exactStandaloneKeys(raw); err != nil {
		return StandaloneRequest{}, err
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return StandaloneRequest{}, Fail(2, "invalid_request", "malformed standalone v2 request")
	}
	if request.ProtocolVersion != StandaloneVersion || request.Target.Validate() != nil || !validStandaloneGeneration(request.RequestID) || !validStandaloneGeneration(request.Generation) {
		return StandaloneRequest{}, Fail(2, "invalid_request", "invalid standalone v2 request")
	}
	return request, nil
}

// encoding/json matches field names without case sensitivity. A private
// protocol must reject aliases rather than letting a later key override one.
func exactStandaloneKeys(raw []byte) error {
	var envelope map[string]json.RawMessage
	if json.Unmarshal(raw, &envelope) != nil || len(envelope) != 5 {
		return Fail(2, "invalid_request", "invalid standalone envelope fields")
	}
	for _, key := range []string{"protocolVersion", "requestID", "target", "generation", "operation"} {
		if _, ok := envelope[key]; !ok {
			return Fail(2, "invalid_request", "invalid standalone envelope fields")
		}
	}
	// There are five fields; missing and additional fields are both refusals.
	return exactStandaloneTargetKeys(envelope["target"])
}

func exactStandaloneTargetKeys(raw []byte) error {
	var target map[string]json.RawMessage
	if json.Unmarshal(raw, &target) != nil || len(target) != 4 {
		return Fail(2, "invalid_request", "invalid standalone target fields")
	}
	for _, key := range []string{"kind", "instanceID", "checkout", "claimDigest"} {
		if _, ok := target[key]; !ok {
			return Fail(2, "invalid_request", "invalid standalone target fields")
		}
	}
	return nil
}

// uniqueJSON walks only an already byte-bounded private envelope. The fixed
// depth limit prevents hostile nesting from exhausting the Go call stack.
func uniqueJSON(raw []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	var value func(int) error
	invalid := func() error {
		return Fail(2, "invalid_request", "private envelope must contain one JSON value with unique keys")
	}
	value = func(depth int) error {
		if depth > 16 {
			return invalid()
		}
		token, err := decoder.Token()
		if err != nil {
			return invalid()
		}
		delimiter, container := token.(json.Delim)
		if !container {
			return nil
		}
		if delimiter != '{' && delimiter != '[' {
			return invalid()
		}
		keys := map[string]bool{}
		for decoder.More() {
			if delimiter == '{' {
				token, err := decoder.Token()
				if err != nil {
					return invalid()
				}
				key, ok := token.(string)
				if !ok || keys[key] {
					return invalid()
				}
				keys[key] = true
			}
			if err := value(depth + 1); err != nil {
				return err
			}
		}
		end, err := decoder.Token()
		if err != nil || (delimiter == '{' && end != json.Delim('}')) || (delimiter == '[' && end != json.Delim(']')) {
			return invalid()
		}
		return nil
	}
	if err := value(0); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return invalid()
	}
	return nil
}

// PublicStandaloneIdentity projects validated private identity into the existing
// schema1 shape. It deliberately contains no claim, checkout or token reference.
func PublicStandaloneIdentity(target StandaloneTarget, generation, displayName string) (BootIdentity, error) {
	if err := target.Validate(); err != nil {
		return BootIdentity{}, err
	}
	if !validStandaloneGeneration(generation) || strings.TrimSpace(displayName) == "" {
		return BootIdentity{}, Fail(2, "invalid_identity", "standalone public identity requires generation and display name")
	}
	return BootIdentity{SchemaVersion: SchemaVersion, InstanceID: target.InstanceID, DisplayName: displayName, Generation: generation, Kind: "development"}, nil
}
