//go:build !windows

package exec

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/terminal"
)

// The local sink tells the manager when the transport took each output (the credit of terminal.DeliveryCredit).
// With the stall watchdog off and a client that reads everything and never acknowledges, five MiB, five times the
// credit, arrive complete: a sink that never credits holds the shell at the high mark for good.
func TestTheLocalSinkCreditsWhatTheTransportTookSoAReadingClientNeverHoldsTheShellUp(t *testing.T) {
	if testing.Short() {
		t.Skip("slow: five MiB through a pty")
	}
	const lines = 1 << 19
	fx := newTerminalFixture(t)
	client := fx.withClient()
	fx.ctrl.terminalManager.SetFlowStall(0) // zero turns the watchdog off: only a real credit lets the shell go on
	script := `awk 'BEGIN { for (i = 0; i < 524288; i++) printf "%08d\n", i }'`
	info := fx.open(fx.page(1), terminal.Options{Command: append(shell(t), "-c", script)})

	require.Eventually(t, func() bool { return len(client.endsOf(info.ID)) == 1 }, 60*time.Second, 20*time.Millisecond,
		"the shell never finished: the sink did not credit what the transport took")
	got, _ := client.received(info.ID)
	assert.Equal(t, lines*10, got)
	assert.Greater(t, got, 4*terminal.FlowHighBytes, "the output is well past the credit")
}
