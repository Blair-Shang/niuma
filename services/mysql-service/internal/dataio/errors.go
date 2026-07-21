// Package dataio 提供 MySQL 旁路落盘异步任务（CSV 导入/导出、Dump SQL、Execute SQL File）。
package dataio

import "errors"

var (
	errPathRequired     = errors.New("mysql: output/input path required")
	errRelationRequired = errors.New("mysql: database and table required")
	errDatabaseRequired = errors.New("mysql: database required")
	errTaskNotFound     = errors.New("mysql: io task not found")
)
