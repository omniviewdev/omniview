// Package transportjson decodes JSON text carried inside a Wails string argument.
// It changes no domain DTO; quoting prevents JavaScript JSON.stringify from
// normalizing an admitted double negative zero before strict SDK admission.
package transportjson

import (
	"bytes"
	"encoding/json"
	"errors"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/omniviewdev/omniview/backend/pkg/apperror"
	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// Decode bounds the inner request before allocation or domain decoding. The
// Wails transport profile separately allows 64 MiB, reserving 64 KiB for routing
// arguments and the method/envelope outside the encoded request string.
func Decode(encoded string, out any, routing ...string) (retErr error) {
	defer func() {
		if retErr != nil {
			retErr = apperror.ForResource(retErr, uuid.NewString())
		}
	}()
	if len(encoded) > resourcev2.MaxMessageBytes {
		return resourcev2.NewError("RESOURCE_LIMIT", "Encoded request JSON exceeds byte limit.")
	}
	routingBytes := 0
	for _, part := range routing {
		if !utf8.ValidString(part) {
			return resourcev2.NewError("INVALID_REQUEST", "Invalid routing Unicode.")
		}
		routingBytes += len(part) + 3
		for i := range len(part) {
			switch part[i] {
			case '"', '\\', '\b', '\f', '\n', '\r', '\t':
				routingBytes++
			default:
				if part[i] < 0x20 {
					routingBytes += 5
				}
			}
		}
		if routingBytes > (64<<10)-8192 {
			return resourcev2.NewError("RESOURCE_LIMIT", "Routing JSON exceeds byte limit.")
		}
	}
	outerBytes := 2
	for i := range len(encoded) {
		outerBytes++
		switch encoded[i] {
		case '"', '\\', '\b', '\f', '\n', '\r', '\t':
			outerBytes++
		default:
			if encoded[i] < 0x20 {
				outerBytes += 5
			}
		}
		if outerBytes > (64<<20)-(64<<10) {
			return resourcev2.NewError("RESOURCE_LIMIT", "Outer request JSON exceeds byte limit.")
		}
	}
	data := []byte(encoded)
	if err := resourcev2.ValidateJSON(data); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	decoder.UseNumber()
	if err := decoder.Decode(out); err != nil {
		var classified *resourcev2.ResourceOperationError
		if errors.As(err, &classified) {
			return err
		}
		return resourcev2.NewError("INVALID_REQUEST", "Invalid encoded request JSON.")
	}
	return nil
}
