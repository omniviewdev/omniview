package plugin

import (
	"testing"

	logging "github.com/omniviewdev/plugin-sdk/log"
)

func testLogger(t *testing.T) logging.Logger {
	t.Helper()
	return logging.NewNop()
}
