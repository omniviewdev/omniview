package store

import (
	"encoding/gob"
	"errors"

	"github.com/omniviewdev/omniview/internal/appstate"
)

// InitStore initializes the local store by ensuring the plugins subdirectory exists.
func InitStore(root *appstate.ScopedRoot) error {
	return root.MkdirAll("plugins", 0755)
}

// RegisterTypes registers the types that are going to be stored in the local store.
func RegisterTypes(impls ...interface{}) {
	for _, impl := range impls {
		gob.Register(impl)
	}
}

// WriteToGlobalStore writes the data to the global store.
func WriteToGlobalStore[T any](root *appstate.ScopedRoot, store string, data T) error {
	storeFile, err := getStoreFile(root, store)
	if err != nil {
		return err
	}
	defer storeFile.Close()

	gob.Register(data)
	encoder := gob.NewEncoder(storeFile)
	return encoder.Encode(data)
}

// ReadFromGlobalStore reads the data from the global store.
func ReadFromGlobalStore[T any](root *appstate.ScopedRoot, store string, data *T) error {
	if data == nil {
		return errors.New("data cannot be nil")
	}

	storeFile, err := getStoreFile(root, store)
	if err != nil {
		return err
	}
	defer storeFile.Close()
	decoder := gob.NewDecoder(storeFile)
	return decoder.Decode(data)
}
