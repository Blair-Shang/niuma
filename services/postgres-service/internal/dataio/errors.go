package dataio

import "errors"

var (
	errPathRequired     = errors.New("postgres: output/input path required")
	errRelationRequired = errors.New("postgres: schema and table required")
	errDatabaseRequired = errors.New("postgres: database required")
	errTaskNotFound     = errors.New("postgres: io task not found")
)
