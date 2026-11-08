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
// NewPolicy accepts it. The zero Policy accepts none, which is the only policy
// production uses until published releases have an accepted floor and
// capability proof.
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

// Verifier observes the identity of the SDK a selection resolves to. Production
// code builds one with NewVerifier; tests inject deterministic verifiers.
type Verifier func(ctx context.Context, selection Selection) (Identity, error)

// NewVerifier returns the production Verifier. A source selection is identified
// with devsource.Verify (HEAD plus the exact tracked and untracked source
// bytes) and admitted under policy. A published selection cannot be verified
// yet and is refused.
func NewVerifier(policy Policy) Verifier {
	return func(ctx context.Context, selection Selection) (Identity, error) {
		directory, ok := selection.Directory()
		if !ok {
			return Identity{}, fmt.Errorf("%w: published SDK releases cannot be verified yet", ErrNotAccepted)
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
