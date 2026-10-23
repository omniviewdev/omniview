//go:build !devcontrol

package devcontrol

import (
	"context"
	"errors"
	"testing"
)

func TestDisabledBuildCannotStartControlListener(t *testing.T) {
	server, err := Start(context.Background(), Config{})
	if server != nil || !errors.Is(err, ErrDisabled) {
		t.Fatalf("disabled Start returned server=%v err=%v", server, err)
	}
	if endpoint := new(Server).Endpoint(); endpoint != "" {
		t.Fatalf("disabled endpoint advertised: %s", endpoint)
	}
}
