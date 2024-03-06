// Package clients contains the clients for the application. The database client is responsible for setting up the
// necessary client for interacting with the internal sqlite database.
package clients

import (
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// NewDatabaseClient creates a new database client for interacting with the internal sqlite database.
func NewDatabaseClient() (*gorm.DB, error) {
	db, err := gorm.Open(sqlite.Open("gorm.db"), &gorm.Config{})
	if err != nil {
		return nil, err
	}

	return db, nil
}
