package terminal

import (
	"errors"
	"fmt"
	"math/rand/v2"
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

// recordedDevice stands for a pty: it records what it is asked to do, in the order it is asked.
// A device with a gate does not answer until the gate opens, as a shell that does not read does not.
type recordedDevice struct {
	mu      sync.Mutex
	log     []string
	gate    chan struct{}
	started chan struct{} // receives once for each operation that begins, when set
	failOn  string
	failErr error
}

func (d *recordedDevice) begin(entry string) error {
	if d.started != nil {
		d.started <- struct{}{}
	}
	if d.gate != nil {
		<-d.gate
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.log = append(d.log, entry)
	if entry == d.failOn {
		return d.failErr
	}
	return nil
}

func (d *recordedDevice) Write(p []byte) (int, error) { return len(p), d.begin("w:" + string(p)) }
func (d *recordedDevice) Resize(rows, cols uint16) error {
	return d.begin(fmt.Sprintf("r:%dx%d", rows, cols))
}

func (d *recordedDevice) entries() []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return append([]string(nil), d.log...)
}

func testLimits() queueLimits {
	return queueLimits{ops: 256, bytes: 1 << 20, ahead: 64, gapWait: 10 * time.Second}
}

// pending reads how many operations the queue holds, to wait until a call has been taken in.
func (q *inputQueue) pendingCount() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.pending
}

func waitPending(t *testing.T, q *inputQueue, want int) {
	t.Helper()
	require.Eventually(t, func() bool { return q.pendingCount() == want }, 10*time.Second, time.Millisecond,
		"the queue should hold %d operations", want)
}

// call runs a queue call in its own goroutine, as every call of the transport runs, and delivers its answer.
func call(f func() error) <-chan error {
	out := make(chan error, 1)
	go func() { out <- f() }()
	return out
}

func within(t *testing.T, answer <-chan error, what string) error {
	t.Helper()
	select {
	case err := <-answer:
		return err
	case <-time.After(10 * time.Second):
		require.FailNow(t, "no answer", what)
		return nil
	}
}

func appError(t *testing.T, err error) *apperror.AppError {
	t.Helper()
	var app *apperror.AppError
	require.ErrorAs(t, err, &app)
	return app
}

// 1,000 writes and resizes, taken from 32 callers at the same time, in whatever order the callers
// get to the queue: the device sees them in the order they were numbered.
func TestQueueAppliesSequencedOperationsInTheOrderTheyWereSentWhateverTheOrderTheyArrive(t *testing.T) {
	const total = 1000
	dev := &recordedDevice{}
	q := newInputQueue(dev, testLimits())
	defer q.close(errors.New("done"))
	var counter atomic.Uint64
	var wg sync.WaitGroup
	for range 32 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				seq := counter.Add(1)
				if seq > total {
					return
				}
				// The jitter is what makes the arrival order differ from the numbering, as a transport does.
				time.Sleep(time.Duration(rand.IntN(300)) * time.Microsecond)
				var err error
				if seq%2 == 0 {
					err = q.write(seq, []byte(strconv.FormatUint(seq, 10)))
				} else {
					err = q.resize(seq, uint16(seq%100+1), uint16(seq%200+1))
				}
				assert.NoError(t, err, "operation %d", seq)
			}
		}()
	}
	wg.Wait()
	want := make([]string, 0, total)
	for seq := uint64(1); seq <= total; seq++ {
		if seq%2 == 0 {
			want = append(want, "w:"+strconv.FormatUint(seq, 10))
		} else {
			want = append(want, fmt.Sprintf("r:%dx%d", seq%100+1, seq%200+1))
		}
	}
	assert.Equal(t, want, dev.entries())
}

// A call without a sequence number is applied in the order its call reached the queue, however long
// the device takes: the first call stands in the device while the others pile up behind it.
func TestQueueAppliesUnsequencedOperationsInTheOrderTheirCallsArrived(t *testing.T) {
	const total = 200
	dev := &recordedDevice{gate: make(chan struct{}), started: make(chan struct{}, total)}
	q := newInputQueue(dev, testLimits())
	defer q.close(errors.New("done"))
	answers := make([]<-chan error, 0, total)
	want := make([]string, 0, total)
	for i := 1; i <= total; i++ {
		i := i
		if i%2 == 0 {
			answers = append(answers, call(func() error { return q.write(0, []byte(strconv.Itoa(i))) }))
			want = append(want, "w:"+strconv.Itoa(i))
		} else {
			answers = append(answers, call(func() error { return q.resize(0, uint16(i), uint16(i)) }))
			want = append(want, fmt.Sprintf("r:%dx%d", i, i))
		}
		waitPending(t, q, i)
	}
	close(dev.gate)
	for i, answer := range answers {
		require.NoError(t, within(t, answer, "operation "+strconv.Itoa(i+1)))
	}
	assert.Equal(t, want, dev.entries())
}

func TestQueueHoldsAnOperationThatArrivesAheadOfItsPredecessor(t *testing.T) {
	dev := &recordedDevice{}
	q := newInputQueue(dev, testLimits())
	defer q.close(errors.New("done"))
	second := call(func() error { return q.write(2, []byte("two")) })
	waitPending(t, q, 1)
	assert.Empty(t, dev.entries(), "an operation must not be applied before its predecessor")
	select {
	case err := <-second:
		require.FailNow(t, "the call answered before its predecessor arrived", "%v", err)
	case <-time.After(50 * time.Millisecond):
	}
	require.NoError(t, q.write(1, []byte("one")))
	require.NoError(t, within(t, second, "the held call"))
	assert.Equal(t, []string{"w:one", "w:two"}, dev.entries())
}

func TestQueueGivesUpAMissingNumberAfterTheGapWaitAndRefusesTheLateCall(t *testing.T) {
	dev := &recordedDevice{}
	limit := testLimits()
	limit.gapWait = 30 * time.Millisecond
	q := newInputQueue(dev, limit)
	defer q.close(errors.New("done"))
	started := time.Now()
	require.NoError(t, q.write(2, []byte("two")), "the held call goes on once the missing number is given up")
	assert.GreaterOrEqual(t, time.Since(started), 25*time.Millisecond, "it waited for its predecessor first")
	late := q.write(1, []byte("one"))
	require.ErrorIs(t, late, ErrSequenceStale)
	assert.Equal(t, TypeSequenceStale, appError(t, late).Type)
	assert.Equal(t, "SEQUENCE_STALE", appError(t, late).Code)
	assert.Equal(t, []string{"w:two"}, dev.entries(), "the late operation is never applied out of order")
	require.NoError(t, q.write(3, []byte("three")), "the sequence goes on from the given-up number")
	assert.Equal(t, []string{"w:two", "w:three"}, dev.entries())
}

func TestQueueRefusesASequenceNumberAlreadyApplied(t *testing.T) {
	q := newInputQueue(&recordedDevice{}, testLimits())
	defer q.close(errors.New("done"))
	require.NoError(t, q.write(1, []byte("one")))
	require.ErrorIs(t, q.write(1, []byte("again")), ErrSequenceStale)
}

func TestQueueRefusesASequenceNumberTooFarAhead(t *testing.T) {
	dev := &recordedDevice{}
	q := newInputQueue(dev, testLimits())
	defer q.close(errors.New("done"))
	err := q.write(1+testLimits().ahead+1, []byte("far"))
	require.ErrorIs(t, err, ErrSequenceAhead)
	assert.Equal(t, TypeSequenceAhead, appError(t, err).Type)
	assert.Equal(t, 0, q.pendingCount(), "a refused operation is not held")
	assert.Empty(t, dev.entries())
}

func TestQueueRefusesASequenceNumberThatIsAlreadyHeld(t *testing.T) {
	q := newInputQueue(&recordedDevice{}, testLimits())
	defer q.close(errors.New("done"))
	held := call(func() error { return q.write(3, []byte("three")) })
	waitPending(t, q, 1)
	require.ErrorIs(t, q.write(3, []byte("three again")), ErrSequenceStale)
	require.NoError(t, q.write(1, []byte("one")))
	require.NoError(t, q.write(2, []byte("two")))
	require.NoError(t, within(t, held, "the held call"))
}

// A caller that floods a shell which does not read gets a typed refusal at once, and every operation
// the queue did take is applied, in order, once the shell reads: nothing is dropped silently.
func TestQueueRefusesAtOnceWhenItsBacklogIsFullAndAppliesEveryOperationItTook(t *testing.T) {
	const capacity = 8
	dev := &recordedDevice{gate: make(chan struct{}), started: make(chan struct{}, 64)}
	limit := testLimits()
	limit.ops = capacity
	q := newInputQueue(dev, limit)
	defer q.close(errors.New("done"))
	answers := make([]<-chan error, 0, capacity)
	want := make([]string, 0, capacity)
	for i := 1; i <= capacity; i++ {
		answers = append(answers, call(func() error { return q.write(0, []byte(strconv.Itoa(i))) }))
		want = append(want, "w:"+strconv.Itoa(i))
		waitPending(t, q, i)
	}
	refused := make(chan error, 1)
	go func() { refused <- q.write(0, []byte("flood")) }()
	err := within(t, refused, "the refused call, which must not wait for the device")
	require.ErrorIs(t, err, ErrInputBacklog)
	assert.Equal(t, TypeInputBacklog, appError(t, err).Type)
	assert.Equal(t, "INPUT_BACKLOG", appError(t, err).Code)
	assert.Equal(t, http.StatusTooManyRequests, appError(t, err).Status)

	close(dev.gate)
	for i, answer := range answers {
		require.NoError(t, within(t, answer, "operation "+strconv.Itoa(i+1)))
	}
	assert.Equal(t, want, dev.entries(), "what was taken is applied in order and what was refused is not")
	require.NoError(t, q.write(0, []byte("after")), "the queue takes input again once it has room")
}

func TestQueueRefusesWhenItHoldsAsManyBytesAsItMay(t *testing.T) {
	dev := &recordedDevice{gate: make(chan struct{}), started: make(chan struct{}, 4)}
	limit := testLimits()
	limit.bytes = 10
	q := newInputQueue(dev, limit)
	defer q.close(errors.New("done"))
	big := call(func() error { return q.write(0, make([]byte, 11)) })
	waitPending(t, q, 1)
	require.ErrorIs(t, q.write(0, []byte("x")), ErrInputBacklog)
	close(dev.gate)
	require.NoError(t, within(t, big, "the large write, taken because nothing waited"))
}

// The operation a backlog refusal turned away consumed no sequence number: the caller sends the same
// number again and it is applied where it belongs.
func TestQueueBacklogRefusalConsumesNoSequenceNumber(t *testing.T) {
	dev := &recordedDevice{gate: make(chan struct{}), started: make(chan struct{}, 8)}
	limit := testLimits()
	limit.ops = 2
	q := newInputQueue(dev, limit)
	defer q.close(errors.New("done"))
	first := call(func() error { return q.write(1, []byte("one")) })
	waitPending(t, q, 1)
	second := call(func() error { return q.write(2, []byte("two")) })
	waitPending(t, q, 2)
	require.ErrorIs(t, q.write(3, []byte("three")), ErrInputBacklog)
	close(dev.gate)
	require.NoError(t, within(t, first, "one"))
	require.NoError(t, within(t, second, "two"))
	require.NoError(t, q.write(3, []byte("three")), "the same number, sent again")
	assert.Equal(t, []string{"w:one", "w:two", "w:three"}, dev.entries())
}

// What a device that does not read costs is one queue: another session's queue goes on.
func TestQueueSlowDeviceDoesNotBlockAnotherQueue(t *testing.T) {
	slow := &recordedDevice{gate: make(chan struct{}), started: make(chan struct{}, 4)}
	quick := &recordedDevice{}
	slowQueue := newInputQueue(slow, testLimits())
	defer slowQueue.close(errors.New("done"))
	quickQueue := newInputQueue(quick, testLimits())
	defer quickQueue.close(errors.New("done"))
	blocked := call(func() error { return slowQueue.write(0, []byte("stuck")) })
	waitPending(t, slowQueue, 1)
	for i := range 100 {
		answer := call(func() error { return quickQueue.write(0, []byte(strconv.Itoa(i))) })
		require.NoError(t, within(t, answer, "the other session's write"))
	}
	assert.Len(t, quick.entries(), 100)
	select {
	case early := <-blocked:
		require.FailNow(t, "the slow device's call answered before the device did", "%v", early)
	default:
	}
	close(slow.gate)
	require.NoError(t, within(t, blocked, "the slow call"))
}

func TestQueueAnswersEveryWaitingCallerWhenItClosesAndStopsAfterTheDeviceReturns(t *testing.T) {
	dev := &recordedDevice{gate: make(chan struct{}), started: make(chan struct{}, 8)}
	q := newInputQueue(dev, testLimits())
	running := call(func() error { return q.write(0, []byte("running")) })
	waitPending(t, q, 1)
	<-dev.started
	queued := call(func() error { return q.write(0, []byte("queued")) })
	waitPending(t, q, 2)
	held := call(func() error { return q.write(5, []byte("held")) })
	waitPending(t, q, 3)

	cause := errors.New("the session ended")
	q.close(cause)
	for name, answer := range map[string]<-chan error{"running": running, "queued": queued, "held": held} {
		require.ErrorIs(t, within(t, answer, name+" call, answered while the device is still blocked"), cause)
	}
	require.ErrorIs(t, q.write(0, []byte("later")), cause, "a call after the close is refused with the cause")
	select {
	case <-q.stopped:
		require.FailNow(t, "the executor cannot have stopped inside a write that did not return")
	default:
	}
	close(dev.gate)
	select {
	case <-q.stopped:
	case <-time.After(10 * time.Second):
		require.FailNow(t, "the executor did not stop after its write returned")
	}
	assert.NotContains(t, dev.entries(), "w:queued", "an operation answered by the close is not applied after it")
}

func TestQueueReturnsADeviceErrorToItsCallerOnly(t *testing.T) {
	boom := errors.New("input/output error")
	dev := &recordedDevice{failOn: "w:two", failErr: boom}
	q := newInputQueue(dev, testLimits())
	defer q.close(errors.New("done"))
	require.NoError(t, q.write(1, []byte("one")))
	require.ErrorIs(t, q.write(2, []byte("two")), boom)
	require.NoError(t, q.write(3, []byte("three")))
	assert.Equal(t, []string{"w:one", "w:two", "w:three"}, dev.entries())
}

func TestQueueAppliesAnEmptyWriteWithoutTouchingTheDevice(t *testing.T) {
	dev := &recordedDevice{}
	q := newInputQueue(dev, testLimits())
	defer q.close(errors.New("done"))
	require.NoError(t, q.write(1, nil))
	require.NoError(t, q.write(2, []byte("two")))
	assert.Equal(t, []string{"w:two"}, dev.entries())
}

// A resize carries no bytes: when the bytes are full because a write waits for it, it is the one call that can
// release them, so it is taken in. A refusal would hold the write until the gap gave the number up, and the
// resize would then be stale.
func TestAResizeThatFullBytesWaitForIsTakenIn(t *testing.T) {
	dev := &recordedDevice{}
	q := newInputQueue(dev, queueLimits{ops: 8, bytes: 4, ahead: 8, gapWait: 10 * time.Second})
	defer q.close(errors.New("done"))
	write := call(func() error { return q.write(2, []byte("abcd")) })
	waitPending(t, q, 1)
	resize := call(func() error { return q.resize(1, 10, 20) })
	require.NoError(t, within(t, resize, "the resize"))
	require.NoError(t, within(t, write, "the write"))
	assert.Equal(t, []string{"r:10x20", "w:abcd"}, dev.entries())
}

// lateDevice reads the bytes it is given only after its gate opens, as a pty takes them from the slice when the
// shell reads.
type lateDevice struct {
	gate    chan struct{}
	started chan struct{}
	got     chan string
}

func (d *lateDevice) Write(p []byte) (int, error) {
	d.started <- struct{}{}
	<-d.gate
	d.got <- string(p)
	return len(p), nil
}

func (d *lateDevice) Resize(uint16, uint16) error { return nil }

// The caller's slice is the caller's again when close answers its write, though the device may still be inside
// it: the queue holds its own copy of the bytes.
func TestTheQueueKeepsItsOwnCopyOfAWrittenSlice(t *testing.T) {
	dev := &lateDevice{gate: make(chan struct{}), started: make(chan struct{}, 1), got: make(chan string, 1)}
	q := newInputQueue(dev, testLimits())
	buf := []byte("original")
	answer := call(func() error { return q.write(0, buf) })
	<-dev.started
	q.close(errors.New("closed"))
	require.Error(t, within(t, answer, "the write the close answered"))
	copy(buf, "REUSED!!")
	close(dev.gate)
	select {
	case got := <-dev.got:
		assert.Equal(t, "original", got, "the device reads what was written, not what the caller put in its slice afterwards")
	case <-time.After(5 * time.Second):
		require.FailNow(t, "the device never got the bytes")
	}
}
