package devsdk

import (
	"context"
	"errors"
	"fmt"

	"github.com/omniviewdev/omniview/internal/devsource"
)

// ErrNotAccepted marks an SDK identity or selection the injected Policy does not
// admit. Callers translate it to their own refusal.
var ErrNotAccepted = errors.New("SDK is not accepted")

// Policy decides which SDK identities may build, attest and launch. It is
// passed to constructors; nothing reads it from the environment or a global.
//
// Source identities are admitted by their own checkout verification and path
// binding. A published identity is admitted only when the function given to
// NewPolicy accepts it: always a complete, validated tuple. The zero Policy
// accepts none; production uses ReleasePolicy.
type Policy struct {
	acceptPublished func(Published) error
}

// NewPolicy returns a Policy that admits a published identity exactly when
// acceptPublished returns nil. A nil function accepts no published identity.
func NewPolicy(acceptPublished func(Published) error) Policy {
	return Policy{acceptPublished: acceptPublished}
}

// Admit validates identity and applies the policy. An identity that is not
// admitted wraps ErrNotAccepted.
func (p Policy) Admit(identity Identity) error {
	if err := identity.Validate(); err != nil {
		return err
	}
	if identity.mode == ModeSource {
		return nil
	}
	if p.acceptPublished == nil {
		return fmt.Errorf("%w: published SDK releases are not accepted", ErrNotAccepted)
	}
	if err := p.acceptPublished(identity.published); err != nil {
		return fmt.Errorf("%w: %w", ErrNotAccepted, err)
	}
	return nil
}

// Request names what a Verifier identifies. A source selection is identified
// from its checkout alone. A published selection is identified from the
// effective Go module graph of one consumer, resolved with the caller's runner.
type Request struct {
	Selection Selection
	Consumer  Consumer
	// Run executes the Go commands a published verification needs. It is unused
	// for a source selection.
	Run Runner
}

// Verifier observes the identity of the SDK a request resolves to. Production
// code builds one with NewVerifier; tests inject deterministic verifiers.
type Verifier func(ctx context.Context, request Request) (Identity, error)

// NewVerifier returns the production Verifier. A source selection is identified
// with devsource.Verify (HEAD plus the exact tracked and untracked source
// bytes) and admitted under policy. A published selection is identified from
// the consumer's effective module graph: see observePublished.
func NewVerifier(policy Policy) Verifier {
	return func(ctx context.Context, request Request) (Identity, error) {
		directory, ok := request.Selection.Directory()
		if !ok {
			observed, err := observePublished(ctx, policy, request.Consumer, request.Run)
			if err != nil {
				return Identity{}, err
			}
			return observed.identity, nil
		}
		observed, err := devsource.Verify(ctx, directory)
		if err != nil {
			return Identity{}, err
		}
		identity, err := NewSourceIdentity(observed)
		if err != nil || observed.Directory != directory {
			return Identity{}, errors.Join(errors.New("SDK verifier returned a different or incomplete selected source identity"), err)
		}
		if err = policy.Admit(identity); err != nil {
			return Identity{}, err
		}
		return identity, nil
	}
}
