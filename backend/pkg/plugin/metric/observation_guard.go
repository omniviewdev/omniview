package metric

import (
	"context"
	"errors"

	resourcev2 "github.com/omniviewdev/plugin-sdk/pkg/resource/v2"
)

// Observation guards are host-only state. They never enter SDK DTOs, provider
// projections, or persistence. Each cache consumer supplies its current admitted
// context, not the cancelled context that originally populated the cache.
type observationGuard func(context.Context) error
type observationGuards map[string][]observationGuard
type observationGuardKey struct{}

func registerObservationGuard(ctx context.Context, token string, guard observationGuard) error {
	guards, ok := ctx.Value(observationGuardKey{}).(observationGuards)
	if !ok {
		return errors.New("resource projection requires shared metric execution context")
	}
	guards[token] = append(guards[token], guard)
	return nil
}
func validateObservationGuards(ctx context.Context, guards []observationGuard) error {
	for _, guard := range guards {
		if err := ctx.Err(); err != nil {
			return err
		}
		if guard(ctx) != nil {
			return resourcev2.NewError("RESET_REQUIRED", "The source observation changed; refresh metrics.")
		}
	}
	return nil
}
