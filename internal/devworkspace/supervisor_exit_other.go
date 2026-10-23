//go:build !darwin

package devworkspace

import "context"

// Other platforms retain the existing post-command process identity wait in
// Down and Restart. Darwin must arm its kernel exit observation before stop.
func shutdownSupervisor(ctx context.Context, _ Workspace, record supervisorRecord, token []byte, command string) (Status, error) {
	return callSupervisor(ctx, record, token, command)
}
