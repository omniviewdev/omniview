package resource

import "testing"

func TestWailsEmitter_ImplementsInterface(t *testing.T) {
	var _ EventEmitter = (*wailsEmitter)(nil)
}

func TestRecordingEmitter_ImplementsInterface(t *testing.T) {
	var _ EventEmitter = (*recordingEmitter)(nil)
}

func TestNoopEmitter_ImplementsInterface(t *testing.T) {
	var _ EventEmitter = (*noopEmitter)(nil)
}
