package devoutputs

import "fmt"

// publicationState is a legal operation/phase pair. The legacy three-field
// encoding stays on disk, but only this decoder interprets that encoding.
// In particular a removal is always a restoration, never a producer publish.
type publicationState uint8

const (
	producerAllocating publicationState = iota
	producerWriting
	producerCaptured
	producerBackedUp
	producerPublished
	producerAborting
	restoreAllocating
	restorePreparing
	restoreCaptured
	restoreBackedUp
	restorePublished
	removalCaptured
	removalBackedUp
	removalPublished
)

type publicationOperation uint8

const (
	produceOutput publicationOperation = iota
	restoreOutput
	removeOutput
)

var publicationEncoding = [...]struct {
	phase     string
	operation publicationOperation
}{
	producerAllocating: {"allocating", produceOutput},
	producerWriting:    {"writing", produceOutput},
	producerCaptured:   {"captured", produceOutput},
	producerBackedUp:   {"backed-up", produceOutput},
	producerPublished:  {"published", produceOutput},
	producerAborting:   {"aborting", produceOutput},
	restoreAllocating:  {"restore-allocating", restoreOutput},
	restorePreparing:   {"restoring", restoreOutput},
	restoreCaptured:    {"captured", restoreOutput},
	restoreBackedUp:    {"backed-up", restoreOutput},
	restorePublished:   {"published", restoreOutput},
	removalCaptured:    {"captured", removeOutput},
	removalBackedUp:    {"backed-up", removeOutput},
	removalPublished:   {"published", removeOutput},
}

func (p *publication) state() (publicationState, error) {
	for state, encoding := range publicationEncoding {
		if p.Phase == encoding.phase && p.Restore == (encoding.operation != produceOutput) && p.Remove == (encoding.operation == removeOutput) {
			return publicationState(state), nil
		}
	}
	return 0, fmt.Errorf("illegal producer publication phase/operation combination")
}

func (p *publication) setState(state publicationState) {
	encoding := publicationEncoding[state]
	p.Phase = encoding.phase
	p.Restore = encoding.operation != produceOutput
	p.Remove = encoding.operation == removeOutput
}

func (state publicationState) operation() publicationOperation {
	return publicationEncoding[state].operation
}

func (operation publicationOperation) backedUp() publicationState {
	switch operation {
	case restoreOutput:
		return restoreBackedUp
	case removeOutput:
		return removalBackedUp
	default:
		return producerBackedUp
	}
}

func (operation publicationOperation) published() publicationState {
	switch operation {
	case restoreOutput:
		return restorePublished
	case removeOutput:
		return removalPublished
	default:
		return producerPublished
	}
}

func requireWriting(entry *outputEntry, token string) error {
	if entry == nil || entry.Pending == nil || entry.Pending.Token != token {
		return fmt.Errorf("producer stage capability is stale")
	}
	state, err := entry.Pending.state()
	if err != nil {
		return err
	}
	if state != producerWriting {
		return fmt.Errorf("producer stage capability is stale or partially published")
	}
	return nil
}
