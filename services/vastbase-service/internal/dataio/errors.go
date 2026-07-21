package dataio

import "errors"

var (
	errPathRequired     = errors.New("vastbase: output/input path required")
	errRelationRequired = errors.New("vastbase: schema and table required")
	errDatabaseRequired = errors.New("vastbase: database required")
	errTaskNotFound     = errors.New("vastbase: io task not found")
)
