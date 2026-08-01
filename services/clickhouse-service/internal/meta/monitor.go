// Package meta — 进程列表 / Kill / 集群只读 / 实例概览（专业会话监控）。
package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// InstanceOverviewResult 是实例级概览（Monitor「实例」页）。
// 字段按 ClickHouse system.* / 标量函数填充；读失败的字段省略（勿把 0 当真实值）。
type InstanceOverviewResult struct {
	Version         string `json:"version"`
	CurrentUser     string `json:"currentUser,omitempty"`
	CurrentDatabase string `json:"currentDatabase,omitempty"`
	HostName        string `json:"hostName,omitempty"`
	ServerAddr      string `json:"serverAddr,omitempty"`
	UptimeSeconds   *int64 `json:"uptimeSeconds,omitempty"`
	DatabaseCount   *int   `json:"databaseCount,omitempty"`
	TableCount      *int   `json:"tableCount,omitempty"`
	DictionaryCount *int   `json:"dictionaryCount,omitempty"`
	ProcessCount    *int   `json:"processCount,omitempty"`
	MemoryTracking  *int64 `json:"memoryTracking,omitempty"`
	ClusterCount    *int   `json:"clusterCount,omitempty"`

	// 健康指标（system.metrics / asynchronous_metrics / disks / replicas）。
	MaxServerMemoryBytes  *int64     `json:"maxServerMemoryBytes,omitempty"`
	OSMemoryTotalBytes    *int64     `json:"osMemoryTotalBytes,omitempty"`
	QueryMetric           *int64     `json:"queryMetric,omitempty"`
	MergeMetric           *int64     `json:"mergeMetric,omitempty"`
	PartMutationMetric    *int64     `json:"partMutationMetric,omitempty"`
	DelayedInserts        *int64     `json:"delayedInserts,omitempty"`
	ReadonlyReplicaMetric *int64     `json:"readonlyReplicaMetric,omitempty"`
	ActiveParts           *int64     `json:"activeParts,omitempty"`
	MaxPartsInPartition   *int64     `json:"maxPartsInPartition,omitempty"`
	MergeTreeBytes        *int64     `json:"mergeTreeBytes,omitempty"`
	RunningMerges         *int       `json:"runningMerges,omitempty"`
	ReplicaTableCount     *int       `json:"replicaTableCount,omitempty"`
	ReadonlyReplicaTables *int       `json:"readonlyReplicaTables,omitempty"`
	MaxReplicaDelaySecs   *int64     `json:"maxReplicaDelaySecs,omitempty"`
	DiskTotalBytes        *int64     `json:"diskTotalBytes,omitempty"`
	DiskFreeBytes         *int64     `json:"diskFreeBytes,omitempty"`
	DiskUsedBytes         *int64     `json:"diskUsedBytes,omitempty"`
	Disks                 []DiskInfo `json:"disks,omitempty"`

	Partial  bool     `json:"partial,omitempty"`
	Warnings []string `json:"warnings,omitempty"`
}

// DiskInfo 是 system.disks 一行摘要。
type DiskInfo struct {
	Name       string `json:"name"`
	Path       string `json:"path,omitempty"`
	Type       string `json:"type,omitempty"`
	TotalBytes int64  `json:"totalBytes"`
	FreeBytes  int64  `json:"freeBytes"`
	UsedBytes  int64  `json:"usedBytes"`
}

// InstanceOverview 读取版本 / uptime / 对象计数 / 健康指标等概览。
func InstanceOverview(ctx context.Context, db *sql.DB) (*InstanceOverviewResult, error) {
	if db == nil {
		return nil, fmt.Errorf("clickhouse: instance overview: nil db")
	}
	out := &InstanceOverviewResult{}
	var missed []string

	if v, err := queryScalarString(ctx, db, "SELECT version()"); err != nil || v == "" {
		missed = append(missed, "version")
	} else {
		out.Version = v
	}
	if v, err := queryScalarString(ctx, db, "SELECT currentUser()"); err == nil {
		out.CurrentUser = v
	} else {
		missed = append(missed, "currentUser")
	}
	if v, err := queryScalarString(ctx, db, "SELECT currentDatabase()"); err == nil {
		out.CurrentDatabase = v
	}
	if v, err := queryScalarString(ctx, db, "SELECT hostName()"); err == nil {
		out.HostName = v
		out.ServerAddr = v
	}

	if n, err := queryScalarInt64(ctx, db, "SELECT toInt64(uptime())"); err == nil {
		out.UptimeSeconds = &n
	} else {
		missed = append(missed, "uptime")
	}

	if n, err := queryScalarInt64(ctx, db, `
SELECT count()
FROM system.databases
WHERE name NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')`); err == nil {
		v := int(n)
		out.DatabaseCount = &v
	} else {
		missed = append(missed, "databaseCount")
	}

	if n, err := queryScalarInt64(ctx, db, `
SELECT count()
FROM system.tables
WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
  AND name NOT LIKE '.inner%'`); err == nil {
		v := int(n)
		out.TableCount = &v
	} else {
		missed = append(missed, "tableCount")
	}

	if n, err := queryScalarInt64(ctx, db, "SELECT count() FROM system.dictionaries"); err == nil {
		v := int(n)
		out.DictionaryCount = &v
	}

	if n, err := queryScalarInt64(ctx, db, "SELECT count() FROM system.processes"); err == nil {
		v := int(n)
		out.ProcessCount = &v
	} else {
		missed = append(missed, "processCount")
	}

	if n, err := queryScalarInt64(ctx, db, "SELECT count(DISTINCT cluster) FROM system.clusters"); err == nil {
		v := int(n)
		out.ClusterCount = &v
	}

	loadOverviewMetrics(ctx, db, out, &missed)
	loadOverviewDisks(ctx, db, out, &missed)
	loadOverviewParts(ctx, db, out, &missed)
	loadOverviewReplicas(ctx, db, out)
	loadOverviewMerges(ctx, db, out, &missed)
	loadOverviewMemoryLimit(ctx, db, out)

	if len(missed) > 0 {
		out.Partial = true
		out.Warnings = append(out.Warnings,
			fmt.Sprintf("partial overview: %s", strings.Join(missed, ", ")))
	}
	if out.Version == "" {
		return nil, fmt.Errorf("clickhouse: instance overview: version unavailable")
	}
	return out, nil
}

func loadOverviewMetrics(ctx context.Context, db *sql.DB, out *InstanceOverviewResult, missed *[]string) {
	rows, err := db.QueryContext(ctx, `
SELECT metric, value
FROM system.metrics
WHERE metric IN (
  'MemoryTracking', 'Query', 'Merge', 'PartMutation',
  'DelayedInserts', 'ReadonlyReplica'
)`)
	if err != nil {
		*missed = append(*missed, "metrics")
		return
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		var value int64
		if err := rows.Scan(&name, &value); err != nil {
			*missed = append(*missed, "metrics")
			return
		}
		v := value
		switch name {
		case "MemoryTracking":
			out.MemoryTracking = &v
		case "Query":
			out.QueryMetric = &v
		case "Merge":
			out.MergeMetric = &v
		case "PartMutation":
			out.PartMutationMetric = &v
		case "DelayedInserts":
			out.DelayedInserts = &v
		case "ReadonlyReplica":
			out.ReadonlyReplicaMetric = &v
		}
	}
	if err := rows.Err(); err != nil {
		*missed = append(*missed, "metrics")
	}

	asyncRows, err := db.QueryContext(ctx, `
SELECT metric, value
FROM system.asynchronous_metrics
WHERE metric IN (
  'MaxPartCountForPartition', 'OSMemoryTotal', 'TotalBytesOfMergeTreeTables'
)`)
	if err != nil {
		return
	}
	defer asyncRows.Close()
	for asyncRows.Next() {
		var name string
		var value float64
		if err := asyncRows.Scan(&name, &value); err != nil {
			return
		}
		n := int64(value)
		switch name {
		case "MaxPartCountForPartition":
			out.MaxPartsInPartition = &n
		case "OSMemoryTotal":
			out.OSMemoryTotalBytes = &n
		case "TotalBytesOfMergeTreeTables":
			out.MergeTreeBytes = &n
		}
	}
}

func loadOverviewDisks(ctx context.Context, db *sql.DB, out *InstanceOverviewResult, missed *[]string) {
	const disksWithType = `
SELECT
  name,
  path,
  type,
  toInt64(total_space),
  toInt64(free_space)
FROM system.disks
ORDER BY name
LIMIT 32`
	const disksNoType = `
SELECT
  name,
  path,
  toInt64(total_space),
  toInt64(free_space)
FROM system.disks
ORDER BY name
LIMIT 32`

	rows, err := db.QueryContext(ctx, disksWithType)
	withType := true
	if err != nil {
		rows, err = db.QueryContext(ctx, disksNoType)
		withType = false
	}
	if err != nil {
		*missed = append(*missed, "disks")
		return
	}
	defer rows.Close()

	var total, free int64
	out.Disks = make([]DiskInfo, 0, 8)
	for rows.Next() {
		var (
			name, path, diskType  string
			totalBytes, freeBytes int64
		)
		var scanErr error
		if withType {
			scanErr = rows.Scan(&name, &path, &diskType, &totalBytes, &freeBytes)
		} else {
			scanErr = rows.Scan(&name, &path, &totalBytes, &freeBytes)
		}
		if scanErr != nil {
			*missed = append(*missed, "disks")
			return
		}
		used := totalBytes - freeBytes
		if used < 0 {
			used = 0
		}
		out.Disks = append(out.Disks, DiskInfo{
			Name:       name,
			Path:       path,
			Type:       diskType,
			TotalBytes: totalBytes,
			FreeBytes:  freeBytes,
			UsedBytes:  used,
		})
		total += totalBytes
		free += freeBytes
	}
	if err := rows.Err(); err != nil {
		*missed = append(*missed, "disks")
		return
	}
	if len(out.Disks) > 0 {
		used := total - free
		if used < 0 {
			used = 0
		}
		out.DiskTotalBytes = &total
		out.DiskFreeBytes = &free
		out.DiskUsedBytes = &used
	}
}

func loadOverviewParts(ctx context.Context, db *sql.DB, out *InstanceOverviewResult, missed *[]string) {
	if n, err := queryScalarInt64(ctx, db, `SELECT count() FROM system.parts WHERE active`); err == nil {
		out.ActiveParts = &n
	} else {
		*missed = append(*missed, "activeParts")
	}
}

func loadOverviewReplicas(ctx context.Context, db *sql.DB, out *InstanceOverviewResult) {
	var tables, readonly sql.NullInt64
	var maxDelay sql.NullInt64
	err := db.QueryRowContext(ctx, `
SELECT
  count(),
  countIf(is_readonly),
  toInt64(max(absolute_delay))
FROM system.replicas`).Scan(&tables, &readonly, &maxDelay)
	if err != nil {
		// 无 Replicated 表或权限不足时常见；不强制记入 missed。
		return
	}
	if tables.Valid {
		v := int(tables.Int64)
		out.ReplicaTableCount = &v
	}
	if readonly.Valid {
		v := int(readonly.Int64)
		out.ReadonlyReplicaTables = &v
	}
	if maxDelay.Valid {
		v := maxDelay.Int64
		out.MaxReplicaDelaySecs = &v
	}
}

func loadOverviewMerges(ctx context.Context, db *sql.DB, out *InstanceOverviewResult, missed *[]string) {
	if n, err := queryScalarInt64(ctx, db, `SELECT count() FROM system.merges`); err == nil {
		v := int(n)
		out.RunningMerges = &v
	} else {
		*missed = append(*missed, "runningMerges")
	}
}

func loadOverviewMemoryLimit(ctx context.Context, db *sql.DB, out *InstanceOverviewResult) {
	if n, err := queryScalarInt64(ctx, db, `
SELECT toInt64OrZero(value)
FROM system.server_settings
WHERE name = 'max_server_memory_usage'
LIMIT 1`); err == nil && n > 0 {
		out.MaxServerMemoryBytes = &n
		return
	}
	if n, err := queryScalarInt64(ctx, db, `
SELECT toInt64OrZero(value)
FROM system.settings
WHERE name = 'max_memory_usage'
LIMIT 1`); err == nil && n > 0 {
		out.MaxServerMemoryBytes = &n
	}
}

func queryScalarString(ctx context.Context, db *sql.DB, q string) (string, error) {
	var s sql.NullString
	if err := db.QueryRowContext(ctx, q).Scan(&s); err != nil {
		return "", err
	}
	if !s.Valid {
		return "", nil
	}
	return strings.TrimSpace(s.String), nil
}

func queryScalarInt64(ctx context.Context, db *sql.DB, q string) (int64, error) {
	var n sql.NullInt64
	if err := db.QueryRowContext(ctx, q).Scan(&n); err != nil {
		return 0, err
	}
	if !n.Valid {
		return 0, fmt.Errorf("clickhouse: null scalar")
	}
	return n.Int64, nil
}

// ProcessInfo 是 system.processes 一行。
type ProcessInfo struct {
	QueryID         string  `json:"queryId"`
	User            string  `json:"user"`
	Host            string  `json:"host"`
	Address         *string `json:"address,omitempty"`
	DB              *string `json:"db,omitempty"`
	QueryKind       *string `json:"queryKind,omitempty"`
	Elapsed         float64 `json:"elapsed"`
	StartTime       string  `json:"startTime,omitempty"`
	ReadRows        *int64  `json:"readRows,omitempty"`
	ReadBytes       *int64  `json:"readBytes,omitempty"`
	WrittenRows     *int64  `json:"writtenRows,omitempty"`
	WrittenBytes    *int64  `json:"writtenBytes,omitempty"`
	MemoryUsage     *int64  `json:"memoryUsage,omitempty"`
	PeakMemoryUsage *int64  `json:"peakMemoryUsage,omitempty"`
	IsCancelled     *bool   `json:"isCancelled,omitempty"`
	Query           *string `json:"query,omitempty"`
}

// ProcessesResult 是 meta.processes 返回。
type ProcessesResult struct {
	Processes []ProcessInfo `json:"processes"`
}

// ClusterHostInfo 是 system.clusters 一行。
type ClusterHostInfo struct {
	Cluster     string `json:"cluster"`
	ShardNum    uint64 `json:"shardNum"`
	ReplicaNum  uint64 `json:"replicaNum"`
	HostName    string `json:"hostName"`
	HostAddress string `json:"hostAddress,omitempty"`
	Port        uint16 `json:"port,omitempty"`
	IsLocal     bool   `json:"isLocal"`
	ErrorsCount uint32 `json:"errorsCount,omitempty"`
}

// ClustersResult 是 meta.clusters 返回。
type ClustersResult struct {
	Hosts []ClusterHostInfo `json:"hosts"`
}

const listProcessesSQL = `
SELECT
  query_id,
  user,
  if(isNotNull(client_hostname) AND client_hostname != '', client_hostname, toString(address)) AS host,
  toString(address) AS address,
  current_database AS db,
  query_kind,
  elapsed,
  toString(now() - toIntervalSecond(toUInt64(elapsed))) AS start_time_str,
  read_rows,
  read_bytes,
  written_rows,
  written_bytes,
  memory_usage,
  peak_memory_usage,
  is_cancelled,
  query
FROM system.processes
ORDER BY elapsed DESC
`

const listClustersSQL = `
SELECT
  cluster,
  shard_num,
  replica_num,
  host_name,
  host_address,
  port,
  is_local,
  errors_count
FROM system.clusters
ORDER BY cluster, shard_num, replica_num
`

// ListProcesses 读取 system.processes。
func ListProcesses(ctx context.Context, db *sql.DB) (*ProcessesResult, error) {
	if db == nil {
		return nil, fmt.Errorf("clickhouse: processes: nil db")
	}
	rows, err := db.QueryContext(ctx, listProcessesSQL)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: system.processes: %w", err)
	}
	defer rows.Close()

	out := &ProcessesResult{Processes: make([]ProcessInfo, 0, 32)}
	for rows.Next() {
		var (
			queryID, user, host, startTime string
			address, dbName                sql.NullString
			queryKind                      sql.NullString
			elapsed                        float64
			readRows                       sql.NullInt64
			readBytes                      sql.NullInt64
			writtenRows                    sql.NullInt64
			writtenBytes                   sql.NullInt64
			memoryUsage                    sql.NullInt64
			peakMemoryUsage                sql.NullInt64
			isCancelled                    sql.NullBool
			query                          sql.NullString
		)
		if err := rows.Scan(
			&queryID, &user, &host, &address, &dbName, &queryKind,
			&elapsed, &startTime, &readRows, &readBytes, &writtenRows, &writtenBytes,
			&memoryUsage, &peakMemoryUsage, &isCancelled, &query,
		); err != nil {
			return nil, fmt.Errorf("clickhouse: scan processes: %w", err)
		}
		p := ProcessInfo{
			QueryID:   queryID,
			User:      user,
			Host:      host,
			Elapsed:   elapsed,
			StartTime: startTime,
		}
		if address.Valid {
			s := address.String
			p.Address = &s
		}
		if dbName.Valid {
			s := dbName.String
			p.DB = &s
		}
		if queryKind.Valid {
			s := queryKind.String
			p.QueryKind = &s
		}
		if readRows.Valid {
			v := readRows.Int64
			p.ReadRows = &v
		}
		if readBytes.Valid {
			v := readBytes.Int64
			p.ReadBytes = &v
		}
		if writtenRows.Valid {
			v := writtenRows.Int64
			p.WrittenRows = &v
		}
		if writtenBytes.Valid {
			v := writtenBytes.Int64
			p.WrittenBytes = &v
		}
		if memoryUsage.Valid {
			v := memoryUsage.Int64
			p.MemoryUsage = &v
		}
		if peakMemoryUsage.Valid {
			v := peakMemoryUsage.Int64
			p.PeakMemoryUsage = &v
		}
		if isCancelled.Valid {
			v := isCancelled.Bool
			p.IsCancelled = &v
		}
		if query.Valid {
			s := query.String
			p.Query = &s
		}
		out.Processes = append(out.Processes, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("clickhouse: processes rows: %w", err)
	}
	return out, nil
}

// KillQuery 执行 KILL QUERY WHERE query_id = '…'。
func KillQuery(ctx context.Context, db *sql.DB, queryID string) error {
	if db == nil {
		return fmt.Errorf("clickhouse: kill: nil db")
	}
	id := strings.TrimSpace(queryID)
	if id == "" {
		return fmt.Errorf("clickhouse: kill: queryId required")
	}
	// 标识符为字符串字面量：单引号加倍。
	escaped := strings.ReplaceAll(id, `'`, `''`)
	q := "KILL QUERY WHERE query_id = '" + escaped + "'"
	if _, err := db.ExecContext(ctx, q); err != nil {
		return fmt.Errorf("clickhouse: kill query: %w", err)
	}
	return nil
}

// ListClusters 读取 system.clusters。
func ListClusters(ctx context.Context, db *sql.DB) (*ClustersResult, error) {
	if db == nil {
		return nil, fmt.Errorf("clickhouse: clusters: nil db")
	}
	rows, err := db.QueryContext(ctx, listClustersSQL)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: system.clusters: %w", err)
	}
	defer rows.Close()

	out := &ClustersResult{Hosts: make([]ClusterHostInfo, 0, 16)}
	for rows.Next() {
		var (
			cluster, hostName, hostAddress string
			shardNum, replicaNum           uint64
			port                           uint16
			isLocal                        uint8
			errorsCount                    uint32
		)
		if err := rows.Scan(
			&cluster, &shardNum, &replicaNum, &hostName, &hostAddress,
			&port, &isLocal, &errorsCount,
		); err != nil {
			return nil, fmt.Errorf("clickhouse: scan clusters: %w", err)
		}
		out.Hosts = append(out.Hosts, ClusterHostInfo{
			Cluster:     cluster,
			ShardNum:    shardNum,
			ReplicaNum:  replicaNum,
			HostName:    hostName,
			HostAddress: hostAddress,
			Port:        port,
			IsLocal:     isLocal != 0,
			ErrorsCount: errorsCount,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("clickhouse: clusters rows: %w", err)
	}
	return out, nil
}
