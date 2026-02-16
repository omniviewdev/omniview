package main

import (
	"bytes"
	"io"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// captureStderr captures stderr output during a function call.
func captureStderr(t *testing.T, fn func()) string {
	t.Helper()

	old := os.Stderr
	r, w, err := os.Pipe()
	require.NoError(t, err)

	os.Stderr = w

	fn()

	w.Close()
	os.Stderr = old

	var buf bytes.Buffer
	_, _ = io.Copy(&buf, r)
	return buf.String()
}

func TestNewLogger(t *testing.T) {
	tests := []struct {
		name    string
		verbose bool
	}{
		{name: "verbose", verbose: true},
		{name: "quiet", verbose: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			log := NewLogger(tt.verbose)
			require.NotNil(t, log)
			assert.Equal(t, tt.verbose, log.verbose)
		})
	}
}

func TestLogger_System(t *testing.T) {
	log := NewLogger(false)
	output := captureStderr(t, func() {
		log.System("hello %s", "world")
	})

	assert.Contains(t, output, "[system]")
	assert.Contains(t, output, "hello world")
}

func TestLogger_Vite(t *testing.T) {
	log := NewLogger(false)
	output := captureStderr(t, func() {
		log.Vite("VITE v5.4.0 ready in 342ms")
	})

	assert.Contains(t, output, "[vite]")
	assert.Contains(t, output, "VITE v5.4.0 ready in 342ms")
}

func TestLogger_Go(t *testing.T) {
	log := NewLogger(false)
	output := captureStderr(t, func() {
		log.Go("./pkg/main.go:10: undefined: Foo")
	})

	assert.Contains(t, output, "[go]")
	assert.Contains(t, output, "./pkg/main.go:10: undefined: Foo")
}

func TestLogger_Plugin(t *testing.T) {
	log := NewLogger(false)
	output := captureStderr(t, func() {
		log.Plugin("plugin initialized")
	})

	assert.Contains(t, output, "[plugin]")
	assert.Contains(t, output, "plugin initialized")
}

func TestLogger_Error(t *testing.T) {
	log := NewLogger(false)
	output := captureStderr(t, func() {
		log.Error("build failed: %v", "syntax error")
	})

	assert.Contains(t, output, "[error]")
	assert.Contains(t, output, "build failed: syntax error")
}

func TestLogger_Debug_Verbose(t *testing.T) {
	log := NewLogger(true)
	output := captureStderr(t, func() {
		log.Debug("watching %d directories", 5)
	})

	assert.Contains(t, output, "[debug]")
	assert.Contains(t, output, "watching 5 directories")
}

func TestLogger_Debug_NotVerbose(t *testing.T) {
	log := NewLogger(false)
	output := captureStderr(t, func() {
		log.Debug("this should not appear")
	})

	assert.Empty(t, output)
}

func TestLogger_Timestamp_Format(t *testing.T) {
	log := NewLogger(false)
	ts := log.timestamp()

	// Should be HH:MM:SS format (8 chars).
	assert.Len(t, ts, 8)
	assert.Equal(t, byte(':'), ts[2])
	assert.Equal(t, byte(':'), ts[5])
}
