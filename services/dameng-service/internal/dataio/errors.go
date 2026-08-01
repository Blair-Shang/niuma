package dataio

import "errors"

var (
	errPathRequired     = errors.New("dameng: path required")
	errRelationRequired = errors.New("dameng: schema and table required")
	errTaskNotFound     = errors.New("dameng: io task not found")
	errDatabaseRequired = errors.New("dameng: schema required")
)
