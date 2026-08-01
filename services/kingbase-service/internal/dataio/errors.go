package dataio

import "errors"

var (
	errPathRequired     = errors.New("kingbase: output/input path required")
	errRelationRequired = errors.New("kingbase: schema and table required")
	errDatabaseRequired = errors.New("kingbase: database required")
	errTaskNotFound     = errors.New("kingbase: io task not found")
)
