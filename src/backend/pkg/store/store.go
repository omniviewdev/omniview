package store

import (
	"encoding/gob"
	"errors"
	"os"
	"path/filepath"
)

// InitStore initializes the local store.
func InitStore() error {
	basePath := getBasePath()

	// make sure the base directory exists
	err := os.MkdirAll(filepath.Join(basePath, "plugins"), 0755)
	if err != nil {
		return err
	}
	return nil
}

// RegisterTypes registers the types that are going to be stored in the local store.
func RegisterTypes(impls ...interface{}) {
	for _, impl := range impls {
		gob.Register(impl)
	}
}

// WriteDataToGlobalStore writes the data to the global store.
func WriteToGlobalStore[T any](store string, data T) error {
	storeFile, err := getStoreFile(store)
	if err != nil {
		return err
	}
	defer storeFile.Close()

	gob.Register(data)
	encoder := gob.NewEncoder(storeFile)
	return encoder.Encode(data)
}

// ReadDataFromGlobalStore reads the data from the global store.
func ReadFromGlobalStore[T any](store string, data *T) error {
	if data == nil {
		return errors.New("data cannot be nil")
	}

	storeFile, err := getStoreFile(store)
	if err != nil {
		return err
	}
	defer storeFile.Close()
	decoder := gob.NewDecoder(storeFile)
	return decoder.Decode(data)
}
