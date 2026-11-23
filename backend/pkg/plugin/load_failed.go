package plugin

import (
	"errors"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	plugintypes "github.com/omniviewdev/omniview/backend/pkg/plugin/types"
	"github.com/omniviewdev/plugin-sdk/pkg/config"
)

// What a load that ends in a failure leaves behind (PU2, status/PU2.md). A window that was told the plugin stopped to start again (UnloadReloaded) waits for it to run, so a load that fails has to
// say so, and the person's Retry (RetryFailedPlugin) needs a record to retry: a plugin that failed before it had a record of its own (its files did not validate, were gone, or could not be read)
// used to vanish from the inventory and answer "not currently loaded".

// startTimeoutError marks a plugin whose process did not answer within the loader's own start timeout (pluginStartTimeout, go-plugin's StartTimeout), so that the cause of the failure is read from
// what timed out and never from the words of the error, which are the plugin's or go-plugin's and may say anything.
type startTimeoutError struct{ err error }

func (e startTimeoutError) Error() string { return e.err.Error() }

func (e startTimeoutError) Unwrap() error { return e.err }

// Timeout reports that the error is a timeout, which is what loadFailureCause reads.
func (startTimeoutError) Timeout() bool { return true }

// handshakeSentence is the one sentence the host says of a plugin whose process started and whose handshake go-plugin refused: it ended before it said anything, or said what is not go-plugin's handshake line, or speaks a
// protocol the host does not offer at all (past offeredProtocolCeiling, where the number of the protocol exists only in the library's error text, which the host never reads). It is the host's own words: go-plugin's are
// about a process the host refused to run, can quote what that process wrote, and list the protocols the host offered in the order of a map, which changes from one run to the next. They go to the host's log and nowhere else.
const handshakeSentence = "The plugin started, but its process did not complete the handshake with Omniview. The details are in the host log."

// handshakeError is a failure of go-plugin's handshake with a process that started (the host's decision to refuse a protocol it recognises is an IncompatibleError, and never this). Its text is the host's own sentence, a
// fixed one; the library's error is what it wraps, for a reader of a type in it (a timeout) and for the log.
type handshakeError struct{ cause error }

func (handshakeError) Error() string { return handshakeSentence }

func (e handshakeError) Unwrap() error { return e.cause }

// loaderStartTimeout is how long a plugin's process may take to start: the loader's one timeout, pluginStartTimeout. A manager of a test may hold a shorter one.
func (pm *pluginManager) loaderStartTimeout() time.Duration {
	if pm.startTimeout > 0 {
		return pm.startTimeout
	}
	return pluginStartTimeout
}

// loadFailureCause is the code the window is told for a load that ended in err: UnloadIncompatible when the host refused the plugin's protocol by number (a typed IncompatibleError), UnloadTimedOut when something in it
// ran out of time (the plugin's process within the start timeout, a call of the host to the plugin within its deadline), else UnloadFailed. Nothing of err's text is read or sent: the plugin's own words, and
// go-plugin's, may say anything, so a cause is always read from a type or from what timed out.
func loadFailureCause(err error) UnloadCause {
	if _, refused := plugintypes.IncompatibilityOf(err); refused {
		return UnloadIncompatible
	}
	var overran interface{ Timeout() bool }
	if errors.As(err, &overran) && overran.Timeout() {
		return UnloadTimedOut
	}
	if status.Code(err) == codes.DeadlineExceeded {
		return UnloadTimedOut
	}
	return UnloadFailed
}

// failedLoad settles a load that ended in err, for the plugin id: the plugin keeps a failed record (a retry has one to retry, and the inventory lists the plugin) and the window is told, in a code, that the load
// failed. `record` is the load's own record, when it got as far as making one (the load of a process stores it as failed itself); `metadata` is what the plugin's files said of it, when they were read.
// A load that failed before there was a record is named by that metadata, else by the state the caller held of the plugin (a reload and the start of the host hold it); with neither there is nothing to name,
// and a load of what is not a plugin there leaves no record and tells no one.
func (pm *pluginManager) failedLoad(id string, opts *LoadPluginOptions, metadata config.PluginMeta, record *plugintypes.PluginRecord, err error) {
	if record == nil {
		named, ok := namedBy(id, metadata, opts)
		if !ok {
			return
		}
		record = newLoadRecord(id, named, opts)
	}

	pm.recordsMu.RLock()
	stored := pm.records[id] == record
	pm.recordsMu.RUnlock()
	if !stored {
		pm.storeFailedRecord(id, record, err)
	}

	emitLoadFailed(pm.emitter, id, err)
}

// namedBy is the metadata a failed load names its plugin by: what the plugin's files said of it, else what the caller held.
func namedBy(id string, read config.PluginMeta, opts *LoadPluginOptions) (config.PluginMeta, bool) {
	if read.ID == id {
		return read, true
	}
	if opts != nil && opts.ExistingState != nil && opts.ExistingState.Metadata.ID == id {
		return opts.ExistingState.Metadata, true
	}
	return config.PluginMeta{}, false
}
