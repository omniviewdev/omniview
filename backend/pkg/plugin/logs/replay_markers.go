// Package logs is the host's lane for plugin logs.
//
// The lane owns the SDK's reserved session parameters.
//
// The SDK reserves every session parameter whose name starts with "omniview." to itself
// (sdklogs.ParamReplayMarkers is the ask for replay markers, sdklogs.ParamReplayMarkersAccepted
// is the plugin's answer). A fact the producer knows is stated by the producer and the consumer
// never guesses, so the lane is the one party that sets the ask: a window (a plugin's UI or the
// runtime) cannot, and what a window sends under that prefix is dropped here before anything
// reaches the plugin. The reply's fact (LogSession.ReplayMarkers), the line's flag (LogLine.Replay)
// and the caught-up event are the SDK's, and the lane hands them to the window as they came.
package logs

import (
	"context"
	"maps"
	"slices"
	"strings"

	sdklogs "github.com/omniviewdev/plugin-sdk/pkg/v1/logs"
)

// reservedParamPrefix starts every parameter name the SDK reserves to itself.
const reservedParamPrefix = "omniview."

// laneParams is the parameters the lane sends the plugin for a window's request: the caller's
// own without any reserved name and, when askForMarkers is set (a session the window creates),
// with the lane's own ask for replay markers. The caller's map is never changed. The names that
// were dropped, never their values, are logged once at Warn.
func (c *controller) laneParams(ctx context.Context, sessionID string, params map[string]string, askForMarkers bool) map[string]string {
	var dropped []string
	for name := range params {
		if strings.HasPrefix(name, reservedParamPrefix) {
			dropped = append(dropped, name)
		}
	}
	if len(dropped) == 0 && !askForMarkers {
		return params
	}
	lane := maps.Clone(params)
	if lane == nil {
		lane = make(map[string]string, 1)
	}
	for _, name := range dropped {
		delete(lane, name)
	}
	if askForMarkers {
		lane[sdklogs.ParamReplayMarkers] = sdklogs.ReplayMarkersOn
	}
	if len(dropped) > 0 && c.logger != nil {
		slices.Sort(dropped)
		c.logger.Warnw(ctx, "dropped reserved log session parameters a window sent", "sessionID", sessionID, "droppedParams", dropped)
	}
	return lane
}
