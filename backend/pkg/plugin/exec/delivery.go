package exec

import (
	"runtime"
	"strings"
)

// skipFrames are the frames of the stack not worth reading: runtime.Callers itself and
// serializedForAClientSocket.
const skipFrames = 2

// serializedForAClientSocket reports whether the serialization that is running is the one that writes a
// client's socket: the JSON encoder that Wails' server mode runs in each client's worker
// (wsjson.Write, which is json.NewEncoder(w).Encode(event)), as opposed to Event.ToJSON (json.Marshal),
// which Wails also runs on every event, in its dispatch worker, for the window it keeps in server mode.
// The first never happens before the socket has taken the event before it; the second always does.
//
// It reads the caller's stack, a few frames deep: a function of the call site is the only difference the
// two serializations have for a payload's MarshalJSON, which gets no context. It costs about two
// microseconds, once or twice an event. If Wails stops serializing that way the answer is wrong, in the
// safe direction (no credit: the watchdog of terminal.flowControl keeps the terminal alive, slowly), and the
// server-tag test and the real-host stall run in the status file are what notice.
func serializedForAClientSocket() bool {
	var pcs [48]uintptr
	n := runtime.Callers(skipFrames, pcs[:])
	frames := runtime.CallersFrames(pcs[:n])
	for {
		frame, more := frames.Next()
		if writesAClientSocket(frame.Function) {
			return true
		}
		if !more {
			return false
		}
	}
}

// writesAClientSocket says whether a function of the stack is the websocket JSON writer or the encoder it
// calls.
func writesAClientSocket(function string) bool {
	return strings.Contains(function, "/wsjson.") || strings.HasSuffix(function, "json.(*Encoder).Encode")
}
