//go:build !windows

package exec

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/omniviewdev/omniview/backend/pkg/apperror"
)

// What a terminal that ended by itself while no page was attached leaves (its end and its output, T2-go.md 2.5) is
// dismissed by CloseSession, as the contract says. The call used to answer not-found and leave the tombstone in the list
// until its lease ran out: the terminal's CLOSE had taken its id out of the exec lane's index, and the lookup in the index
// came first, so the call never reached the terminal manager that keeps the tombstone.
func TestCloseSessionDismissesTheEndOfATerminalThatEndedWhileDetached(t *testing.T) {
	fx := newTerminalFixture(t)
	first, second := fx.page(1), fx.page(2)
	info := fx.mustOpenKeyed(first, keyA, `printf 'up\n'; sleep 1; exit 0`)
	require.Eventually(t, func() bool { text, _ := fx.positioned(info.ID); return strings.Contains(text, "up\r\n") }, 20*time.Second, 5*time.Millisecond)
	fx.retire(first)
	fx.detached(info.ID)
	require.Eventually(t, func() bool {
		listed := fx.listed(second, keyA)
		return len(listed) == 1 && listed[0].Ended != nil
	}, 30*time.Second, 20*time.Millisecond, "the terminal ended by itself while detached and left its end")

	require.NoError(t, fx.wrapper.CloseSession(info.ID), "the page that has read how it ended dismisses it")
	assert.Empty(t, fx.listed(second, keyA), "and it is gone from the list")
	err := fx.wrapper.CloseSession(info.ID)
	var app *apperror.AppError
	require.ErrorAs(t, err, &app, "a second close finds nothing")
	assert.Equal(t, apperror.TypeSessionNotFound, app.Type)
	require.ErrorAs(t, fx.wrapper.CloseSession("no-such-session"), &app)
	assert.Equal(t, apperror.TypeSessionNotFound, app.Type, "and an id that never was is still not found")
}
