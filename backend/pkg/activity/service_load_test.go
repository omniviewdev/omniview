package activity

import (
	"os"
	"testing"
)

func TestOversizedHistoryRejectedBeforeDecode(t *testing.T) {
	_, root := testService(t)
	file, err := root.OpenFile("activities.json", os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(maxActivityFileBytes + 1); err != nil {
		file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := NewService(root, nil); err == nil {
		t.Fatal("oversized history admitted")
	}
}

func TestMissingPersistedCollectionRejected(t *testing.T) {
	_, root := testService(t)
	if err := root.WriteFile("activities.json", []byte(`{"version":1,"revision":0,"records":null}`), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewService(root, nil); err == nil {
		t.Fatal("nil persisted collection admitted")
	}
}
