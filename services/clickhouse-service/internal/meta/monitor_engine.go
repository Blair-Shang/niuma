package meta

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
)

// MergeInfo 是 system.merges 一行。
type MergeInfo struct {
	Database                 string  `json:"database"`
	Table                    string  `json:"table"`
	Elapsed                  float64 `json:"elapsed"`
	StartTime                string  `json:"startTime,omitempty"`
	Progress                 float64 `json:"progress"`
	NumParts                 uint64  `json:"numParts"`
	IsMutation               bool    `json:"isMutation"`
	TotalSizeBytesCompressed *int64  `json:"totalSizeBytesCompressed,omitempty"`
	BytesReadUncompressed    *int64  `json:"bytesReadUncompressed,omitempty"`
	RowsRead                 *int64  `json:"rowsRead,omitempty"`
	ResultPartName           string  `json:"resultPartName,omitempty"`
	PartitionID              string  `json:"partitionId,omitempty"`
}

// MergesResult 是 meta.merges 返回。
type MergesResult struct {
	Merges []MergeInfo `json:"merges"`
}

// ReplicaInfo 是 system.replicas 一行。
type ReplicaInfo struct {
	Database           string `json:"database"`
	Table              string `json:"table"`
	IsLeader           bool   `json:"isLeader"`
	IsReadonly         bool   `json:"isReadonly"`
	AbsoluteDelay      int64  `json:"absoluteDelay"`
	QueueSize          uint64 `json:"queueSize"`
	InsertsInQueue     uint64 `json:"insertsInQueue"`
	MergesInQueue      uint64 `json:"mergesInQueue"`
	TotalReplicas      uint32 `json:"totalReplicas"`
	ActiveReplicas     uint32 `json:"activeReplicas"`
	ZookeeperException string `json:"zookeeperException,omitempty"`
}

// ReplicasResult 是 meta.replicas 返回。
type ReplicasResult struct {
	Replicas []ReplicaInfo `json:"replicas"`
}

// PartsTableInfo 是按表聚合的 active parts 摘要。
type PartsTableInfo struct {
	Database    string `json:"database"`
	Table       string `json:"table"`
	Parts       uint64 `json:"parts"`
	Rows        uint64 `json:"rows"`
	BytesOnDisk int64  `json:"bytesOnDisk"`
	Partitions  uint64 `json:"partitions"`
}

// PartsResult 是 meta.parts 返回。
type PartsResult struct {
	Tables   []PartsTableInfo `json:"tables"`
	Partial  bool             `json:"partial,omitempty"`
	Warnings []string         `json:"warnings,omitempty"`
}

// MutationInfo 是 system.mutations 一行（未完成优先）。
type MutationInfo struct {
	Database         string `json:"database"`
	Table            string `json:"table"`
	MutationID       string `json:"mutationId"`
	Command          string `json:"command,omitempty"`
	CreateTime       string `json:"createTime,omitempty"` // 开始时间
	ElapsedSecs      int64  `json:"elapsedSecs,omitempty"`
	PartsToDo        int64  `json:"partsToDo"`
	IsDone           bool   `json:"isDone"`
	LatestFailedPart string `json:"latestFailedPart,omitempty"`
	LatestFailReason string `json:"latestFailReason,omitempty"`
	LatestFailTime   string `json:"latestFailTime,omitempty"`
}

// MutationsResult 是 meta.mutations 返回。
type MutationsResult struct {
	Mutations []MutationInfo `json:"mutations"`
}

const listMergesSQL = `
SELECT
  database,
  table,
  elapsed,
  toString(now() - toIntervalSecond(toUInt64(elapsed))) AS start_time_str,
  progress,
  num_parts,
  is_mutation,
  total_size_bytes_compressed,
  bytes_read_uncompressed,
  rows_read,
  result_part_name,
  partition_id
FROM system.merges
ORDER BY elapsed DESC
LIMIT 200
`

const listReplicasSQL = `
SELECT
  database,
  table,
  is_leader,
  is_readonly,
  toInt64(absolute_delay),
  queue_size,
  inserts_in_queue,
  merges_in_queue,
  total_replicas,
  active_replicas,
  zookeeper_exception
FROM system.replicas
ORDER BY absolute_delay DESC, queue_size DESC, database, table
LIMIT 500
`

const (
	maxPartsResultTables   = 200
	partsPerDatabaseLimit  = 80
	partsTableBatchSize    = 20
	partsEnrichTopN        = 40
)

const listMutationsSQL = `
SELECT
  database,
  table,
  mutation_id,
  command,
  toString(create_time) AS create_time_str,
  toInt64(dateDiff('second', create_time, now())) AS elapsed_secs,
  toInt64(parts_to_do) AS parts_to_do,
  is_done,
  latest_failed_part,
  latest_fail_reason,
  if(latest_fail_time = toDateTime(0), '', toString(latest_fail_time)) AS latest_fail_time_str
FROM system.mutations
WHERE NOT is_done
  AND database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
ORDER BY create_time DESC
LIMIT 200
`

// ListMutations 读取未完成的 system.mutations。
func ListMutations(ctx context.Context, db *sql.DB) (*MutationsResult, error) {
	if db == nil {
		return nil, fmt.Errorf("clickhouse: mutations: nil db")
	}
	rows, err := db.QueryContext(ctx, listMutationsSQL)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: system.mutations: %w", err)
	}
	defer rows.Close()

	out := &MutationsResult{Mutations: make([]MutationInfo, 0, 16)}
	for rows.Next() {
		var (
			database, table, mutationID, command string
			createTime, failedPart, failReason   string
			failTime                             string
			elapsedSecs, partsToDo               int64
			isDone                               uint8
		)
		if err := rows.Scan(
			&database, &table, &mutationID, &command, &createTime, &elapsedSecs,
			&partsToDo, &isDone, &failedPart, &failReason, &failTime,
		); err != nil {
			return nil, fmt.Errorf("clickhouse: scan mutations: %w", err)
		}
		out.Mutations = append(out.Mutations, MutationInfo{
			Database:         database,
			Table:            table,
			MutationID:       mutationID,
			Command:          command,
			CreateTime:       createTime,
			ElapsedSecs:      elapsedSecs,
			PartsToDo:        partsToDo,
			IsDone:           isDone != 0,
			LatestFailedPart: strings.TrimSpace(failedPart),
			LatestFailReason: strings.TrimSpace(failReason),
			LatestFailTime:   strings.TrimSpace(failTime),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("clickhouse: mutations rows: %w", err)
	}
	return out, nil
}

// ListMerges 读取 system.merges。
func ListMerges(ctx context.Context, db *sql.DB) (*MergesResult, error) {
	if db == nil {
		return nil, fmt.Errorf("clickhouse: merges: nil db")
	}
	rows, err := db.QueryContext(ctx, listMergesSQL)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: system.merges: %w", err)
	}
	defer rows.Close()

	out := &MergesResult{Merges: make([]MergeInfo, 0, 16)}
	for rows.Next() {
		var (
			database, table, startTime, resultPart, partitionID string
			elapsed, progress                                   float64
			numParts                                            uint64
			isMutation                                          uint8
			totalSize, bytesRead, rowsRead                      sql.NullInt64
		)
		if err := rows.Scan(
			&database, &table, &elapsed, &startTime, &progress, &numParts, &isMutation,
			&totalSize, &bytesRead, &rowsRead, &resultPart, &partitionID,
		); err != nil {
			return nil, fmt.Errorf("clickhouse: scan merges: %w", err)
		}
		m := MergeInfo{
			Database:       database,
			Table:          table,
			Elapsed:        elapsed,
			StartTime:      startTime,
			Progress:       progress,
			NumParts:       numParts,
			IsMutation:     isMutation != 0,
			ResultPartName: resultPart,
			PartitionID:    partitionID,
		}
		if totalSize.Valid {
			v := totalSize.Int64
			m.TotalSizeBytesCompressed = &v
		}
		if bytesRead.Valid {
			v := bytesRead.Int64
			m.BytesReadUncompressed = &v
		}
		if rowsRead.Valid {
			v := rowsRead.Int64
			m.RowsRead = &v
		}
		out.Merges = append(out.Merges, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("clickhouse: merges rows: %w", err)
	}
	return out, nil
}

// ListReplicas 读取 system.replicas。
func ListReplicas(ctx context.Context, db *sql.DB) (*ReplicasResult, error) {
	if db == nil {
		return nil, fmt.Errorf("clickhouse: replicas: nil db")
	}
	rows, err := db.QueryContext(ctx, listReplicasSQL)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: system.replicas: %w", err)
	}
	defer rows.Close()

	out := &ReplicasResult{Replicas: make([]ReplicaInfo, 0, 32)}
	for rows.Next() {
		var (
			database, table, zkEx string
			isLeader, isReadonly  uint8
			absoluteDelay         int64
			queueSize             uint64
			insertsInQueue        uint64
			mergesInQueue         uint64
			totalReplicas         uint32
			activeReplicas        uint32
		)
		if err := rows.Scan(
			&database, &table, &isLeader, &isReadonly, &absoluteDelay,
			&queueSize, &insertsInQueue, &mergesInQueue,
			&totalReplicas, &activeReplicas, &zkEx,
		); err != nil {
			return nil, fmt.Errorf("clickhouse: scan replicas: %w", err)
		}
		out.Replicas = append(out.Replicas, ReplicaInfo{
			Database:           database,
			Table:              table,
			IsLeader:           isLeader != 0,
			IsReadonly:         isReadonly != 0,
			AbsoluteDelay:      absoluteDelay,
			QueueSize:          queueSize,
			InsertsInQueue:     insertsInQueue,
			MergesInQueue:      mergesInQueue,
			TotalReplicas:      totalReplicas,
			ActiveReplicas:     activeReplicas,
			ZookeeperException: zkEx,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("clickhouse: replicas rows: %w", err)
	}
	return out, nil
}

// ListParts 按库/表分片聚合 active parts，避免一次扫全量 system.parts 导致 OOM (code 241)。
func ListParts(ctx context.Context, db *sql.DB) (*PartsResult, error) {
	if db == nil {
		return nil, fmt.Errorf("clickhouse: parts: nil db")
	}
	databases, err := listUserDatabases(ctx, db)
	if err != nil {
		return nil, err
	}

	out := &PartsResult{Tables: make([]PartsTableInfo, 0, 64)}
	var skipped []string
	for _, database := range databases {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		chunk, qerr := listPartsCountsForDatabase(ctx, db, database)
		if qerr != nil {
			chunk, qerr = listPartsCountsByTableBatches(ctx, db, database)
		}
		if qerr != nil {
			skipped = append(skipped, database)
			continue
		}
		out.Tables = append(out.Tables, chunk...)
	}

	sort.Slice(out.Tables, func(i, j int) bool {
		if out.Tables[i].Parts == out.Tables[j].Parts {
			return out.Tables[i].BytesOnDisk > out.Tables[j].BytesOnDisk
		}
		return out.Tables[i].Parts > out.Tables[j].Parts
	})
	if len(out.Tables) > maxPartsResultTables {
		out.Tables = out.Tables[:maxPartsResultTables]
		out.Partial = true
	}
	enrichPartsDetails(ctx, db, out.Tables, partsEnrichTopN)

	if len(skipped) > 0 {
		out.Partial = true
		out.Warnings = append(out.Warnings,
			fmt.Sprintf("skipped databases (memory/limit): %s", strings.Join(skipped, ", ")))
	}
	return out, nil
}

func quoteCHString(s string) string {
	return "'" + strings.ReplaceAll(s, `'`, `''`) + "'"
}

func listUserDatabases(ctx context.Context, db *sql.DB) ([]string, error) {
	rows, err := db.QueryContext(ctx, `
SELECT name
FROM system.databases
WHERE name NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
ORDER BY name`)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: system.databases: %w", err)
	}
	defer rows.Close()
	out := make([]string, 0, 16)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("clickhouse: scan databases: %w", err)
		}
		out = append(out, name)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("clickhouse: databases rows: %w", err)
	}
	return out, nil
}

func listMergeTreeTables(ctx context.Context, db *sql.DB, database string) ([]string, error) {
	q := fmt.Sprintf(`
SELECT name
FROM system.tables
WHERE database = %s
  AND engine LIKE '%%MergeTree%%'
  AND name NOT LIKE '.inner%%'
ORDER BY name
LIMIT 2000`, quoteCHString(database))
	rows, err := db.QueryContext(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: system.tables: %w", err)
	}
	defer rows.Close()
	out := make([]string, 0, 64)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("clickhouse: scan tables: %w", err)
		}
		out = append(out, name)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("clickhouse: tables rows: %w", err)
	}
	return out, nil
}

// listPartsCountsForDatabase 单库内只做 count 聚合（最轻），WHERE database 可显著缩小 system.parts 扫描。
func listPartsCountsForDatabase(ctx context.Context, db *sql.DB, database string) ([]PartsTableInfo, error) {
	q := fmt.Sprintf(`
SELECT
  table,
  count() AS parts
FROM system.parts
WHERE active
  AND database = %s
GROUP BY table
ORDER BY parts DESC
LIMIT %d`, quoteCHString(database), partsPerDatabaseLimit)
	rows, err := db.QueryContext(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: system.parts: %w", err)
	}
	defer rows.Close()

	out := make([]PartsTableInfo, 0, 32)
	for rows.Next() {
		var table string
		var parts uint64
		if err := rows.Scan(&table, &parts); err != nil {
			return nil, fmt.Errorf("clickhouse: scan parts: %w", err)
		}
		out = append(out, PartsTableInfo{
			Database: database,
			Table:    table,
			Parts:    parts,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("clickhouse: parts rows: %w", err)
	}
	return out, nil
}

func listPartsCountsByTableBatches(ctx context.Context, db *sql.DB, database string) ([]PartsTableInfo, error) {
	tables, err := listMergeTreeTables(ctx, db, database)
	if err != nil {
		return nil, err
	}
	if len(tables) == 0 {
		return nil, nil
	}
	out := make([]PartsTableInfo, 0, len(tables))
	for i := 0; i < len(tables); i += partsTableBatchSize {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		end := i + partsTableBatchSize
		if end > len(tables) {
			end = len(tables)
		}
		batch := tables[i:end]
		chunk, qerr := listPartsCountsForTables(ctx, db, database, batch)
		if qerr != nil {
			// 批次仍失败则逐表查询，尽量不丢整库。
			for _, table := range batch {
				one, oneErr := listPartsCountsForTables(ctx, db, database, []string{table})
				if oneErr != nil || len(one) == 0 {
					continue
				}
				out = append(out, one...)
			}
			continue
		}
		out = append(out, chunk...)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Parts > out[j].Parts })
	if len(out) > partsPerDatabaseLimit {
		out = out[:partsPerDatabaseLimit]
	}
	return out, nil
}

func listPartsCountsForTables(ctx context.Context, db *sql.DB, database string, tables []string) ([]PartsTableInfo, error) {
	if len(tables) == 0 {
		return nil, nil
	}
	quoted := make([]string, len(tables))
	for i, t := range tables {
		quoted[i] = quoteCHString(t)
	}
	q := fmt.Sprintf(`
SELECT
  table,
  count() AS parts
FROM system.parts
WHERE active
  AND database = %s
  AND table IN (%s)
GROUP BY table
ORDER BY parts DESC`, quoteCHString(database), strings.Join(quoted, ", "))
	rows, err := db.QueryContext(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: system.parts: %w", err)
	}
	defer rows.Close()

	out := make([]PartsTableInfo, 0, len(tables))
	for rows.Next() {
		var table string
		var parts uint64
		if err := rows.Scan(&table, &parts); err != nil {
			return nil, fmt.Errorf("clickhouse: scan parts: %w", err)
		}
		out = append(out, PartsTableInfo{
			Database: database,
			Table:    table,
			Parts:    parts,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("clickhouse: parts rows: %w", err)
	}
	return out, nil
}

// enrichPartsDetails 仅对 TopN 补齐行数/字节/分区数，避免对所有表做重聚合。
func enrichPartsDetails(ctx context.Context, db *sql.DB, tables []PartsTableInfo, topN int) {
	if topN <= 0 || len(tables) == 0 {
		return
	}
	if topN > len(tables) {
		topN = len(tables)
	}
	for i := 0; i < topN; i++ {
		if err := ctx.Err(); err != nil {
			return
		}
		t := &tables[i]
		q := fmt.Sprintf(`
SELECT
  sum(rows) AS rows,
  toInt64(sum(bytes_on_disk)) AS bytes_on_disk,
  toUInt64(uniq(partition_id)) AS partitions
FROM system.parts
WHERE active
  AND database = %s
  AND table = %s`, quoteCHString(t.Database), quoteCHString(t.Table))
		var rowsCount uint64
		var bytesOnDisk int64
		var partitions uint64
		if err := db.QueryRowContext(ctx, q).Scan(&rowsCount, &bytesOnDisk, &partitions); err != nil {
			continue
		}
		t.Rows = rowsCount
		t.BytesOnDisk = bytesOnDisk
		t.Partitions = partitions
	}
}
