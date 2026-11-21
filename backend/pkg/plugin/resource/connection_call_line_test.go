package resource

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// These tests drive the registry alone, one step at a time, so that the order of
// events is fixed. A waiter is woken when the channel it was handed is closed.

func requireWoken(t *testing.T, wake <-chan struct{}, what string) {
	t.Helper()
	select {
	case <-wake:
	default:
		t.Fatalf("%s was not woken", what)
	}
}

// Every change that can let a waiter go on wakes it, or the waiter would sleep
// until some unrelated change: a call that ends, the transaction at the head that
// goes on (the next one is first in line then), and a transaction that gives up
// (the calls queued behind it may go on).
func TestEveryChangeThatCanLetAWaiterGoOnWakesIt(t *testing.T) {
	a := connectionCallKey{plugin: "p", connection: "a"}
	b := connectionCallKey{plugin: "p", connection: "b"}

	t.Run("a call ends", func(t *testing.T) {
		var calls connectionCalls
		_, got := calls.begin(a, nil)
		require.Equal(t, verdictProceed, got, "the first call")
		first := &transactionWait{plugin: "p"}
		firstWake, got := calls.quiesce(first, nil)
		require.Equal(t, verdictWait, got, "a transaction behind a call")
		callWake, got := calls.begin(b, nil)
		require.Equal(t, verdictWait, got, "a call behind a transaction")

		calls.end(a)
		requireWoken(t, firstWake, "the transaction")
		requireWoken(t, callWake, "the call queued behind it")
	})

	t.Run("the transaction at the head goes on", func(t *testing.T) {
		var calls connectionCalls
		_, got := calls.begin(a, nil)
		require.Equal(t, verdictProceed, got, "the first call")
		first, second := &transactionWait{plugin: "p"}, &transactionWait{plugin: "p"}
		_, got = calls.quiesce(first, nil)
		require.Equal(t, verdictWait, got, "the first transaction")
		_, got = calls.quiesce(second, nil)
		require.Equal(t, verdictWait, got, "the second transaction")
		calls.end(a)

		// The second transaction asks before the first one goes on, and waits for it.
		secondWake, got := calls.quiesce(second, nil)
		require.Equal(t, verdictWait, got, "the second transaction, with the first one in line")
		_, got = calls.quiesce(first, nil)
		require.Equal(t, verdictProceed, got, "the first transaction")
		requireWoken(t, secondWake, "the second transaction")
		_, got = calls.quiesce(second, nil)
		require.Equal(t, verdictProceed, got, "the second transaction, now first in line")
		require.Empty(t, calls.waiting, "no transaction is left in line")
	})

	t.Run("a transaction gives up", func(t *testing.T) {
		var calls connectionCalls
		_, got := calls.begin(a, nil)
		require.Equal(t, verdictProceed, got, "the first call")
		transaction := &transactionWait{plugin: "p"}
		_, got = calls.quiesce(transaction, nil)
		require.Equal(t, verdictWait, got, "the transaction")
		callWake, got := calls.begin(b, nil)
		require.Equal(t, verdictWait, got, "a call behind the transaction")

		calls.leave(transaction)
		requireWoken(t, callWake, "the call queued behind the transaction")
		_, got = calls.begin(b, nil)
		require.Equal(t, verdictProceed, got, "the call, once the transaction gave up, beside the first call")
		require.Empty(t, calls.waiting, "no transaction is left in line")
	})
}

// Transactions that wait for one plugin go on one at a time, in the order in
// which they began to wait. A transaction that comes while the plugin is quiet
// still queues behind the ones that wait.
func TestTransactionsGoOnInTheOrderTheyBeganToWait(t *testing.T) {
	var calls connectionCalls
	a := connectionCallKey{plugin: "p", connection: "a"}
	_, got := calls.begin(a, nil)
	require.Equal(t, verdictProceed, got, "the first call")
	first, second, third := &transactionWait{plugin: "p"}, &transactionWait{plugin: "p"}, &transactionWait{plugin: "p"}
	for _, transaction := range []*transactionWait{first, second} {
		_, got = calls.quiesce(transaction, nil)
		require.Equal(t, verdictWait, got, "a transaction behind the call")
	}
	calls.end(a)
	_, got = calls.quiesce(third, nil)
	require.Equal(t, verdictWait, got, "a transaction that comes while the plugin is quiet, behind two that wait")

	for _, step := range []struct {
		transaction *transactionWait
		name        string
		want        verdict
	}{
		{third, "the third transaction, asking first", verdictWait},
		{second, "the second transaction, asking first", verdictWait},
		{first, "the first transaction", verdictProceed},
		{third, "the third transaction, with the second in line", verdictWait},
		{second, "the second transaction", verdictProceed},
		{third, "the third transaction", verdictProceed},
	} {
		_, got = calls.quiesce(step.transaction, nil)
		require.Equal(t, step.want, got, step.name)
	}
	require.Empty(t, calls.waiting, "no transaction is left in line")
}

// The queue belongs to a plugin. A call made from inside a registered call of the
// plugin goes on, because the transaction waits for that call; a mark of a call
// that has ended, or of another plugin, does not exempt anything. A transaction
// that comes from inside a registered call of its plugin would wait for that
// call, and gets no place in line.
func TestMarkOfARegisteredCallExemptsAStartFromTheLineAndFailsATransaction(t *testing.T) {
	a := connectionCallKey{plugin: "p", connection: "a"}
	b := connectionCallKey{plugin: "p", connection: "b"}
	c := connectionCallKey{plugin: "p", connection: "c"}
	other := connectionCallKey{plugin: "q", connection: "a"}

	var calls connectionCalls
	_, got := calls.begin(a, nil)
	require.Equal(t, verdictProceed, got, "the first call")
	_, got = calls.begin(other, nil)
	require.Equal(t, verdictProceed, got, "a call of another plugin")
	_, got = calls.quiesce(&transactionWait{plugin: "p"}, &a)
	require.Equal(t, verdictReentry, got, "a transaction from inside the first call")
	require.Empty(t, calls.waiting, "a transaction that fails fast takes no place in line")

	waiting := &transactionWait{plugin: "p"}
	_, got = calls.quiesce(waiting, nil)
	require.Equal(t, verdictWait, got, "a transaction from outside")
	_, got = calls.begin(b, &a)
	require.Equal(t, verdictProceed, got, "a call from inside the first call, beside a waiting transaction")
	_, got = calls.begin(a, &a)
	require.Equal(t, verdictReentry, got, "a second call on the connection it is inside")
	_, got = calls.begin(c, nil)
	require.Equal(t, verdictWait, got, "a call without a mark")
	_, got = calls.begin(c, &other)
	require.Equal(t, verdictWait, got, "a call marked with a call of another plugin")
	_, got = calls.begin(connectionCallKey{plugin: "q", connection: "b"}, nil)
	require.Equal(t, verdictProceed, got, "a call of another plugin")

	calls.end(a)
	_, got = calls.begin(c, &a)
	require.Equal(t, verdictWait, got, "a call marked with a call that has ended")
}
