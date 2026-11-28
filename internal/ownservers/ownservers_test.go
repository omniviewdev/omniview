package ownservers

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestAnAddressIsThereWhileItListensAndGoneWhenRemoved(t *testing.T) {
	remove := Add("127.0.0.1:41001")
	other := Add("127.0.0.1:41002")
	assert.ElementsMatch(t, []string{"127.0.0.1:41001", "127.0.0.1:41002"}, filtered())
	remove()
	remove() // a second call changes nothing, and does not remove the other
	assert.Equal(t, []string{"127.0.0.1:41002"}, filtered())
	other()
	assert.Empty(t, filtered())
}

func filtered() []string {
	var out []string
	for _, a := range Addresses() {
		if a == "127.0.0.1:41001" || a == "127.0.0.1:41002" {
			out = append(out, a)
		}
	}
	return out
}
