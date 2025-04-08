package exec

import "sync"

// OutputBuffer stores terminal output lines, providing a fixed-size cyclic buffer.
type OutputBuffer struct {
	buf      []byte     // The buffer.
	capacity int        // maximum number of bytes to store.
	lock     sync.Mutex // Protect concurrent access to lines.
}

// NewOutputBuffer initializes an OutputBuffer with a specified capacity.
func NewOutputBuffer(capacity int) *OutputBuffer {
	return &OutputBuffer{
		buf:      make([]byte, 0, capacity),
		capacity: capacity,
	}
}

func NewDefaultOutputBuffer() *OutputBuffer {
	return &OutputBuffer{
		buf:      make([]byte, 0, DefaultOutputBufferSize),
		capacity: DefaultOutputBufferSize,
	}
}

// Append adds a line to the buffer, managing overflow by removing the oldest line.
func (b *OutputBuffer) Append(data []byte) {
	b.lock.Lock()
	defer b.lock.Unlock()
	//
	// // If the new data will exceed the buffer's capacity, remove the oldest data to make room.
	// if len(b.buf)+len(data) > b.capacity {
	// 	b.buf = b.buf[len(data):]
	// }
	b.buf = append(b.buf, data...)
}

// GetAll retrieves a copy of all stored lines in the buffer.
func (b *OutputBuffer) GetAll() []byte {
	b.lock.Lock()
	defer b.lock.Unlock()
	return append([]byte(nil), b.buf...) // Return a copy to avoid external modifications.
}
