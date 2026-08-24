package dataio

import "errors"

var (
	errPathRequired     = errors.New("sqlserver: path required")
	errRelationRequired = errors.New("sqlserver: schema and table required")
	errTaskNotFound     = errors.New("sqlserver: io task not found")
	errDatabaseRequired = errors.New("sqlserver: database required")
)
