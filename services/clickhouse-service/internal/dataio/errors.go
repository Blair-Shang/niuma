// Package dataio 提供 ClickHouse 旁路落盘异步任务（CSV 导入/导出、Dump SQL、Execute SQL File）。
//
// 本包独立实现，禁止 import 其它 *-service 的 dataio。ClickHouse 无传统事务，dump/exec 不写 BEGIN/COMMIT。
package dataio

import "errors"

var (
	errPathRequired     = errors.New("clickhouse: output/input path required")
	errRelationRequired = errors.New("clickhouse: database and table required")
	errDatabaseRequired = errors.New("clickhouse: database required")
	errTaskNotFound     = errors.New("clickhouse: io task not found")
)
