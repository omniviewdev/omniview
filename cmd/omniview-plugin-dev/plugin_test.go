package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsHandshakeLine(t *testing.T) {
	tests := []struct {
		name     string
		line     string
		expected bool
	}{
		{
			name:     "valid handshake",
			line:     "1|1|tcp|127.0.0.1:42367|grpc",
			expected: true,
		},
		{
			name:     "valid handshake with whitespace",
			line:     "  1|1|tcp|127.0.0.1:42367|grpc  ",
			expected: true,
		},
		{
			name:     "wrong core protocol version",
			line:     "2|1|tcp|127.0.0.1:42367|grpc",
			expected: false,
		},
		{
			name:     "too few parts",
			line:     "1|1|tcp|127.0.0.1:42367",
			expected: false,
		},
		{
			name:     "too many parts",
			line:     "1|1|tcp|127.0.0.1:42367|grpc|extra",
			expected: false,
		},
		{
			name:     "empty string",
			line:     "",
			expected: false,
		},
		{
			name:     "random log line",
			line:     "2025/01/15 10:30:00 plugin started",
			expected: false,
		},
		{
			name:     "pipe separated but wrong count",
			line:     "a|b|c",
			expected: false,
		},
		{
			name:     "five parts but first is not 1",
			line:     "0|1|tcp|127.0.0.1:42367|grpc",
			expected: false,
		},
		{
			name:     "valid with unix socket",
			line:     "1|1|unix|/tmp/plugin.sock|grpc",
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, isHandshakeLine(tt.line))
		})
	}
}
