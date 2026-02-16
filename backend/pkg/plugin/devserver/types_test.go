package devserver

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewLogRingBuffer(t *testing.T) {
	rb := NewLogRingBuffer(10)
	require.NotNil(t, rb)
	assert.Equal(t, 10, rb.cap)
	assert.Equal(t, 0, rb.count)
	assert.Equal(t, 0, rb.head)
}

func TestLogRingBuffer_Push_UnderCapacity(t *testing.T) {
	rb := NewLogRingBuffer(5)

	for i := range 3 {
		rb.Push(LogEntry{Message: fmt.Sprintf("msg-%d", i)})
	}

	assert.Equal(t, 3, rb.count)
	assert.Equal(t, 0, rb.head)

	entries := rb.Entries()
	require.Len(t, entries, 3)
	assert.Equal(t, "msg-0", entries[0].Message)
	assert.Equal(t, "msg-1", entries[1].Message)
	assert.Equal(t, "msg-2", entries[2].Message)
}

func TestLogRingBuffer_Push_AtCapacity(t *testing.T) {
	rb := NewLogRingBuffer(3)

	for i := range 3 {
		rb.Push(LogEntry{Message: fmt.Sprintf("msg-%d", i)})
	}

	assert.Equal(t, 3, rb.count)

	entries := rb.Entries()
	require.Len(t, entries, 3)
	assert.Equal(t, "msg-0", entries[0].Message)
	assert.Equal(t, "msg-2", entries[2].Message)
}

func TestLogRingBuffer_Push_OverCapacity(t *testing.T) {
	rb := NewLogRingBuffer(3)

	for i := range 5 {
		rb.Push(LogEntry{Message: fmt.Sprintf("msg-%d", i)})
	}

	// Should still have 3 entries, with the oldest dropped.
	assert.Equal(t, 3, rb.count)

	entries := rb.Entries()
	require.Len(t, entries, 3)
	assert.Equal(t, "msg-2", entries[0].Message)
	assert.Equal(t, "msg-3", entries[1].Message)
	assert.Equal(t, "msg-4", entries[2].Message)
}

func TestLogRingBuffer_Push_WrapAround(t *testing.T) {
	rb := NewLogRingBuffer(3)

	// Fill it and then push many more to exercise multiple wrap-arounds.
	for i := range 10 {
		rb.Push(LogEntry{Message: fmt.Sprintf("msg-%d", i)})
	}

	entries := rb.Entries()
	require.Len(t, entries, 3)
	assert.Equal(t, "msg-7", entries[0].Message)
	assert.Equal(t, "msg-8", entries[1].Message)
	assert.Equal(t, "msg-9", entries[2].Message)
}

func TestLogRingBuffer_Entries_Empty(t *testing.T) {
	rb := NewLogRingBuffer(5)
	entries := rb.Entries()
	assert.Empty(t, entries)
}

func TestLogRingBuffer_Last(t *testing.T) {
	rb := NewLogRingBuffer(10)

	for i := range 5 {
		rb.Push(LogEntry{Message: fmt.Sprintf("msg-%d", i)})
	}

	tests := []struct {
		name     string
		n        int
		expected []string
	}{
		{
			name:     "last 2",
			n:        2,
			expected: []string{"msg-3", "msg-4"},
		},
		{
			name:     "last 5 (all)",
			n:        5,
			expected: []string{"msg-0", "msg-1", "msg-2", "msg-3", "msg-4"},
		},
		{
			name:     "last 10 (more than count, clamped)",
			n:        10,
			expected: []string{"msg-0", "msg-1", "msg-2", "msg-3", "msg-4"},
		},
		{
			name:     "last 1",
			n:        1,
			expected: []string{"msg-4"},
		},
		{
			name:     "last 0",
			n:        0,
			expected: []string{},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := rb.Last(tt.n)
			require.Len(t, result, len(tt.expected))
			for i, e := range tt.expected {
				assert.Equal(t, e, result[i].Message)
			}
		})
	}
}

func TestLogRingBuffer_Last_AfterWrapAround(t *testing.T) {
	rb := NewLogRingBuffer(3)

	for i := range 7 {
		rb.Push(LogEntry{Message: fmt.Sprintf("msg-%d", i)})
	}

	result := rb.Last(2)
	require.Len(t, result, 2)
	assert.Equal(t, "msg-5", result[0].Message)
	assert.Equal(t, "msg-6", result[1].Message)
}

func TestLogRingBuffer_Clear(t *testing.T) {
	rb := NewLogRingBuffer(5)

	for i := range 3 {
		rb.Push(LogEntry{Message: fmt.Sprintf("msg-%d", i)})
	}
	assert.Equal(t, 3, rb.count)

	rb.Clear()
	assert.Equal(t, 0, rb.count)
	assert.Equal(t, 0, rb.head)
	assert.Empty(t, rb.Entries())
}

func TestLogRingBuffer_Clear_ThenReuse(t *testing.T) {
	rb := NewLogRingBuffer(3)

	for i := range 5 {
		rb.Push(LogEntry{Message: fmt.Sprintf("old-%d", i)})
	}
	rb.Clear()

	rb.Push(LogEntry{Message: "new-0"})
	rb.Push(LogEntry{Message: "new-1"})

	entries := rb.Entries()
	require.Len(t, entries, 2)
	assert.Equal(t, "new-0", entries[0].Message)
	assert.Equal(t, "new-1", entries[1].Message)
}
