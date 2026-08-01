package dataio

import "errors"

var (
	errPathRequired     = errors.New("sqlite: path required")
	errRelationRequired = errors.New("sqlite: schema and table required")
	errTaskNotFound     = errors.New("sqlite: io task not found")
	errDatabaseRequired = errors.New("sqlite: schema required")
)
