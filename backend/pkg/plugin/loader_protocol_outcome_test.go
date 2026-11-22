package plugin

import plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"

// refusedByNumber is whether err is the host's refusal of a plugin by the number of its protocol (S4). The measurement of loader_protocol_child_test.go asks it of the starts that are meant to be refused. It is in a file of its
// own because the tree before S4 has no such refusal: there, a stub of it (func refusedByNumber(error) bool { return true }) lets the measurement build, and S4_MEASURE_EXPECT=failed measures a refusal.
func refusedByNumber(err error) bool {
	_, refused := plugintypes.IncompatibilityOf(err)
	return refused
}
